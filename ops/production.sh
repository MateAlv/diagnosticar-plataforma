#!/usr/bin/env bash
# Production control for nodo0, compose project `diagnosticar`.
#
#   ops/production.sh up TAG              # backup, then run a released tag; ops/deploy.sh production
#                                         # also smoke-tests it and records it
#   ops/production.sh smoke
#   ops/production.sh backup              # pg_dump into ~/backups/diagnosticar
#   ops/production.sh rehearse-restore [DUMP] [TAG]
#                                         # restore a dump into a throwaway database,
#                                         # optionally run TAG's migrations on it
#   ops/production.sh ps | logs
#
# There is no down and no reset: nothing here stops production or deletes data.
# PRODUCTION.md is the runbook.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROJECT=diagnosticar
ENV_FILE="$REPO_ROOT/.env"
GHCR="ghcr.io/${GHCR_OWNER:-matealv}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/diagnosticar}"
RESTORE_CHECK=diagnosticar-restore-check

die() { echo "REFUSING: $*" >&2; exit 1; }

# 1. Only the account that owns production runs it. The account the staging
#    deploys run under, and any other on this shared host, cannot by accident.
PRODUCTION_USER="${DIAGNOSTICAR_PRODUCTION_USER:-<usuario>}"
[ "$(id -un)" = "$PRODUCTION_USER" ] || die "production runs as $PRODUCTION_USER, not $(id -un)."

# 2. Production's .env, readable by its owner alone: it holds the database
#    password and the signing keys, and every account on nodo0 can list /home.
[ -f "$ENV_FILE" ] || die "missing $ENV_FILE; PRODUCTION.md says what goes in it."
[ "$(stat -c %a "$ENV_FILE")" = 600 ] || die "$ENV_FILE is mode $(stat -c %a "$ENV_FILE"); run: chmod 600 $ENV_FILE"

read_env() {
    sed -n "s/^$1=//p" "$ENV_FILE" | head -1
}

# 3. Never staging's host.
DIAGNOSTICAR_HOST="$(read_env DIAGNOSTICAR_HOST)"
case "$DIAGNOSTICAR_HOST" in
  "") die "DIAGNOSTICAR_HOST is not set in $ENV_FILE." ;;
  *staging*) die "DIAGNOSTICAR_HOST is $DIAGNOSTICAR_HOST, a staging host." ;;
esac

COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV_FILE"
         -f docker-compose.yml -f docker-compose.prod.yml)

GENE_PROFILES_DB="${GENE_PROFILES_DB:-$PWD/data/genes.db}"
if [ -f "$GENE_PROFILES_DB" ]; then
  export GENE_PROFILES_DB
  COMPOSE+=(-f docker-compose.genes.yml)
  echo "Gene profiles: $GENE_PROFILES_DB ($(du -h "$GENE_PROFILES_DB" | cut -f1))"
else
  echo "Gene profiles: none at $GENE_PROFILES_DB — genes will render without descriptions."
fi

# What the services need before a release with them can start. Checked by
# name only; no value is printed.
preflight() {
  local missing=() key
  for key in POSTGRES_USER POSTGRES_DB JWT_ACCESS_SECRET JWT_REFRESH_SECRET \
             JWT_ACCESS_PRIVATE_KEY JWT_ACCESS_PUBLIC_KEY TRUSTED_PROXIES; do
    [ -n "$(read_env "$key")" ] || missing+=("$key")
  done
  if [ -z "$(read_env CLAUDE_CODE_OAUTH_TOKEN)" ] && [ -z "$(read_env ANTHROPIC_API_KEY)" ]; then
    missing+=("CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY")
  fi
  [ ${#missing[@]} -eq 0 ] || die "not set in $ENV_FILE: ${missing[*]} (PRODUCTION.md, step 2)."
}

free_gib() {
  df -Pk "$1" | awk 'NR == 2 { print int($4 / 1048576) }'
}

# Prints the path of the new dump. Fails, and leaves no partial file behind,
# when the dump is empty or pg_restore cannot read it.
backup() {
  local stamp file
  umask 077
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  [ "$(free_gib "$BACKUP_DIR")" -ge 5 ] || die "less than 5 GiB free for $BACKUP_DIR."
  stamp="$(date +%Y%m%d-%H%M%S)"
  file="$BACKUP_DIR/diagnosticar-$stamp-${1:-manual}.dump"
  # Inside the container, so pg_dump matches the server's version and the
  # credentials never leave it.
  if ! "${COMPOSE[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$file.part"; then
    rm -f "$file.part"
    die "pg_dump failed; nothing was deployed."
  fi
  if [ ! -s "$file.part" ] || ! "${COMPOSE[@]}" exec -T db pg_restore -l < "$file.part" > /dev/null; then
    rm -f "$file.part"
    die "the dump is empty or unreadable; nothing was deployed."
  fi
  mv "$file.part" "$file"
  echo "Backup: $file ($(du -h "$file" | cut -f1))" >&2
  echo "$file"
}

COUNT_SQL="SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM patients), (SELECT count(*) FROM diagnoses)"

restored_counts() {
  docker exec "$RESTORE_CHECK" psql -U diagnosticar -d diagnosticar -tA -F ' ' -c "$COUNT_SQL"
}

live_counts() {
  "${COMPOSE[@]}" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F " " -c "$0"' "$COUNT_SQL"
}

# Restores into a Postgres that has no network and keeps its data in memory,
# then throws it away. Touches no volume, and production's database only to
# count its rows.
rehearse_restore() {
  local dump=${1:-} tag=${2:-} password before after live
  if [ -z "$dump" ]; then
    dump="$(ls -1t "$BACKUP_DIR"/diagnosticar-*.dump 2>/dev/null | head -1 || true)"
  fi
  [ -s "$dump" ] || die "no dump to restore; run ops/production.sh backup first."
  docker ps -a --format '{{.Names}}' | grep -qx "$RESTORE_CHECK" \
    && die "$RESTORE_CHECK already exists; another rehearsal is running."

  password="$(openssl rand -hex 16)"
  echo "Restoring $dump into a throwaway database ($RESTORE_CHECK)"
  docker run -d --rm --name "$RESTORE_CHECK" --network none \
    --tmpfs /var/lib/postgresql/data:rw,size=4g \
    -e POSTGRES_USER=diagnosticar -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=diagnosticar \
    postgres:15-alpine > /dev/null
  # --rm removes it once stopped. Only this container, which this run created.
  trap 'docker stop "$RESTORE_CHECK" > /dev/null 2>&1 || true' EXIT

  # During initdb the server listens on the socket only; TCP answers once the
  # real server is up.
  local i
  for i in $(seq 1 60); do
    docker exec "$RESTORE_CHECK" pg_isready -q -h 127.0.0.1 -U diagnosticar && break
    [ "$i" = 60 ] && die "the throwaway database never started."
    sleep 1
  done

  docker exec -i "$RESTORE_CHECK" pg_restore -U diagnosticar -d diagnosticar \
    --no-owner --no-privileges --exit-on-error < "$dump"
  before="$(restored_counts)"
  live="$(live_counts)"
  echo "  users, patients, diagnoses restored: $before"
  echo "  users, patients, diagnoses live now: $live (higher only if rows were added since the dump)"

  if [ -n "$tag" ]; then
    echo "Running the migrations of $tag on the restored copy"
    docker pull -q "$GHCR/diagnosticar-backend:$tag" > /dev/null
    # NODE_ENV=development so config falls back for everything but the
    # database; the secrets below sign nothing and never leave this container.
    docker run --rm --network "container:$RESTORE_CHECK" \
      -e NODE_ENV=development \
      -e DATABASE_URL="postgresql://diagnosticar:$password@127.0.0.1:5432/diagnosticar" \
      -e JWT_ACCESS_SECRET="$(openssl rand -hex 32)" -e JWT_REFRESH_SECRET="$(openssl rand -hex 32)" \
      "$GHCR/diagnosticar-backend:$tag" \
      node -e "import('./dist/database/pool.js').then(async (m) => { await m.migrate(); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); })"
    after="$(restored_counts)"
    echo "  users, patients, diagnoses migrated: $after"
    [ "$before" = "$after" ] || die "the migrations of $tag changed the row counts."
  fi
  echo "RESTORE REHEARSAL PASS"
}

case "${1:-}" in
  up)
    tag="${2:-}"
    [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "up needs a release tag, got '${tag}'."
    preflight
    running="$(cat "${DEPLOY_STATE_DIR:-$HOME/.local/state/diagnosticar/production}/current" 2>/dev/null || echo pre-cd)"
    backup "before-$tag-from-$running" > /dev/null
    export RELEASE_TAG="$tag"
    export FRONTEND_IMAGE="diagnosticar-frontend"
    COMPOSE+=(-f docker-compose.deploy.yml)
    "${COMPOSE[@]}" pull backend frontend hpo-recognizer model question-agent
    "${COMPOSE[@]}" up -d --no-build --remove-orphans
    echo "Production is at https://${DIAGNOSTICAR_HOST}"
    ;;
  smoke)
    SMOKE_FRONTEND_URL="https://${DIAGNOSTICAR_HOST}" \
    SMOKE_BACKEND_URL="https://${DIAGNOSTICAR_HOST}" \
    SMOKE_HEALTH_PATH="/api/health" \
    SMOKE_MODEL_SERVICES=true \
      "$REPO_ROOT/ops/smoke.sh"
    ;;
  backup) backup manual ;;
  rehearse-restore) rehearse_restore "${2:-}" "${3:-}" ;;
  ps)   "${COMPOSE[@]}" ps ;;
  logs) "${COMPOSE[@]}" logs -f --tail 100 ;;
  *)
    echo "usage: ops/production.sh {up TAG|smoke|backup|rehearse-restore [DUMP] [TAG]|ps|logs}" >&2
    exit 1
    ;;
esac
