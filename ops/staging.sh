#!/usr/bin/env bash
# Staging control for nodo0.
#
# Runs under its own compose project name so it never shares containers,
# networks or volumes with production on the same host.
#
#   ops/staging.sh up [TAG]   # deploy a tag (default: build from the working tree)
#   ops/staging.sh down
#   ops/staging.sh logs
#   ops/staging.sh smoke
#   ops/staging.sh reset-db   # wipe staging data and re-seed
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${STAGING_ENV_FILE:-$REPO_ROOT/.env.staging}"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE — copy .env.staging.example and fill it in." >&2; exit 1; }

# Read the values this script needs directly, without sourcing the file.
#
# `source` would let the shell expand STAGING_BASIC_AUTH, whose htpasswd hash
# contains "$$" doubled for compose interpolation — and to the shell "$$" is the
# process id. The hash arrives at Traefik as "equipo:1865433apr11865433", the
# middleware fails to parse, Traefik drops it, and every route answers 401 with
# a correct password. Compose reads the file itself via --env-file, where the
# doubling means what it is supposed to mean.
read_env() {
    sed -n "s/^$1=//p" "$ENV_FILE" | head -1
}

STAGING_HOST="$(read_env STAGING_HOST)"
STAGING_BASIC_AUTH="$(read_env STAGING_BASIC_AUTH)"
STAGING_SMOKE_PASSWORD="$(read_env STAGING_SMOKE_PASSWORD)"
STAGING_JWT_ACCESS_SECRET="$(read_env STAGING_JWT_ACCESS_SECRET)"
STAGING_JWT_REFRESH_SECRET="$(read_env STAGING_JWT_REFRESH_SECRET)"

PROJECT=diagnosticar-staging

# nodo0 is a shared host: 57 containers across 13 compose projects, and
# production diagnostic.ar runs there as project "diagnosticar" — one suffix
# away from ours. These assertions make the difference impossible to get wrong
# by accident, rather than merely documented. See ops/NODO0_SAFETY.md.

# 1. Never operate out of production's deployment directory.
case "$REPO_ROOT" in
  */<usuario>/*)
    echo "REFUSING: $REPO_ROOT is production's deployment directory." >&2
    echo "Run staging from your own checkout." >&2
    exit 1
    ;;
esac

# 2. Never load production's environment file.
case "$(basename "$ENV_FILE")" in
  .env.staging) ;;
  *)
    echo "REFUSING: $ENV_FILE is not .env.staging." >&2
    echo "Loading production's .env would point staging at production's database." >&2
    exit 1
    ;;
esac

# 3. Staging must carry its own secrets. Sharing production's would let a
#    staging session authenticate against production.
if [ -z "${STAGING_JWT_ACCESS_SECRET:-}" ] || [ -z "${STAGING_JWT_REFRESH_SECRET:-}" ]; then
  echo "REFUSING: STAGING_JWT_* secrets are not set in $ENV_FILE." >&2
  echo "Generate them with ops/make-staging-env.sh." >&2
  exit 1
fi

COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV_FILE"
         -f docker-compose.yml -f docker-compose.staging.yml)

# Gene descriptions are a file copied to the host with scp, not part of any
# image, so the overlay is added only when the file is actually there. Without
# it the platform runs normally and the results screen shows genes with no
# description — and a bind mount pointing at a missing file would silently
# create a root-owned directory instead of failing.
GENE_PROFILES_DB="${GENE_PROFILES_DB:-$PWD/data/genes.db}"
if [ -f "$GENE_PROFILES_DB" ]; then
  export GENE_PROFILES_DB
  COMPOSE+=(-f docker-compose.genes.yml)
  echo "Gene profiles: $GENE_PROFILES_DB ($(du -h "$GENE_PROFILES_DB" | cut -f1))"
else
  echo "Gene profiles: none at $GENE_PROFILES_DB — genes will render without descriptions."
fi

case "${1:-up}" in
  up)
    if [ -n "${2:-}" ]; then
      export RELEASE_TAG="$2"
      # The frontend bundle has its API URLs compiled in, so staging pulls an
      # image built against the staging host rather than reconfiguring the
      # production one — which would post every request to production.
      export FRONTEND_IMAGE="diagnosticar-frontend-staging"
      COMPOSE+=(-f docker-compose.deploy.yml)
      "${COMPOSE[@]}" pull backend frontend hpo-recognizer genphenai
      "${COMPOSE[@]}" up -d --no-build --remove-orphans
    else
      # No tag: build the working tree. This is the "does my branch survive the
      # real model services" path.
      "${COMPOSE[@]}" up -d --build --remove-orphans
    fi
    echo "Staging is at https://${STAGING_HOST}"
    ;;
  down)   "${COMPOSE[@]}" down ;;
  logs)   "${COMPOSE[@]}" logs -f ;;
  ps)     "${COMPOSE[@]}" ps ;;
  smoke)
    # Runs against the public staging host so Traefik, TLS and the basic-auth
    # middleware are all in the path.
    #
    # STAGING_BASIC_AUTH is an htpasswd line — "user:$$apr1$$hash" — with the
    # dollars doubled to survive compose interpolation. curl needs the plain
    # password, which the hash does not contain, so the password is supplied
    # separately via STAGING_SMOKE_PASSWORD. Without it every check reads 401
    # and the suite fails on a healthy stack.
    smoke_user="${STAGING_BASIC_AUTH%%:*}"
    if [ -n "${STAGING_SMOKE_PASSWORD:-}" ]; then
      export SMOKE_BASIC_AUTH="${smoke_user}:${STAGING_SMOKE_PASSWORD}"
    else
      echo "Note: STAGING_SMOKE_PASSWORD is not set in $ENV_FILE." >&2
      echo "      Every check will return 401 because staging requires basic auth." >&2
    fi
    SMOKE_FRONTEND_URL="https://${STAGING_HOST}" \
    SMOKE_BACKEND_URL="https://${STAGING_HOST}" \
    SMOKE_HEALTH_PATH="/api/health" \
      "$REPO_ROOT/ops/smoke.sh"
    ;;
  reset-db)
    # The only destructive path in this repo. It runs `down -v`, which deletes a
    # volume permanently — so it proves which volume before asking, rather than
    # trusting that the project name is right.
    volume="$("${COMPOSE[@]}" config --format json 2>/dev/null \
      | grep -o '"name": *"[^"]*postgres_data"' | head -1 | sed 's/.*: *"//; s/"//')"

    case "$volume" in
      diagnosticar-staging_*)
        ;;
      *)
        echo "REFUSING: resolved volume is '${volume:-unknown}', not a staging volume." >&2
        echo "Production's volume is diagnosticar_postgres_data and holds clinical records." >&2
        exit 1
        ;;
    esac

    echo "This permanently deletes the staging volume:"
    echo "    $volume"
    echo "Production's volume (diagnosticar_postgres_data) is NOT affected."
    read -rp "Type the word 'staging' to confirm: " confirm
    [ "$confirm" = "staging" ] || { echo "Aborted."; exit 0; }
    "${COMPOSE[@]}" down -v
    "${COMPOSE[@]}" up -d
    echo "Staging database recreated empty; migrations run on backend boot."
    ;;
  *)
    echo "usage: ops/staging.sh {up [TAG]|down|logs|ps|smoke|reset-db}" >&2
    exit 1
    ;;
esac
