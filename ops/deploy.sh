#!/usr/bin/env bash
# Pull-based deploy for nodo0.
#
# Nothing reaches into this machine. The node asks GitHub whether a newer
# release exists, and if so pulls images CI already built and tested, restarts
# the stack, and runs ops/smoke.sh. A failed smoke check rolls straight back to
# the tag that was running before, so a bad release costs a restart rather than
# an outage.
#
# Install as a systemd timer (see ops/systemd/) or run by hand:
#   ops/deploy.sh              # deploy the latest release if it differs
#   ops/deploy.sh v1.4.2       # deploy a specific tag
#   ops/deploy.sh --rollback   # go back to the previous tag
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

STATE_DIR="${DEPLOY_STATE_DIR:-/var/lib/diagnosticar}"
CURRENT_FILE="$STATE_DIR/current-tag"
PREVIOUS_FILE="$STATE_DIR/previous-tag"
GITHUB_REPO="${GITHUB_REPO:-MateAlv/diagnostic.ar}"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"

COMPOSE=(docker compose --env-file "$ENV_FILE"
         -f docker-compose.yml
         -f docker-compose.prod.yml
         -f docker-compose.deploy.yml)

log()  { echo "[$(date -Is)] $*"; }
die()  { log "ERROR: $*"; exit 1; }

mkdir -p "$STATE_DIR"
[ -f "$ENV_FILE" ] || die "environment file not found at $ENV_FILE"

# ---------------------------------------------------------------------------
# Resolve the tag to deploy
# ---------------------------------------------------------------------------
latest_release() {
  local auth=()
  # A token is only needed while the repository is private. Store it root-owned
  # at /etc/diagnosticar/github-token with mode 0600.
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  elif [ -r /etc/diagnosticar/github-token ]; then
    auth=(-H "Authorization: Bearer $(cat /etc/diagnosticar/github-token)")
  fi
  curl -sf --max-time 20 "${auth[@]}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1
}

CURRENT_TAG="$(cat "$CURRENT_FILE" 2>/dev/null || echo "")"

case "${1:-}" in
  --rollback)
    TARGET_TAG="$(cat "$PREVIOUS_FILE" 2>/dev/null || echo "")"
    [ -n "$TARGET_TAG" ] || die "no previous tag recorded; nothing to roll back to"
    log "Rolling back to $TARGET_TAG"
    ;;
  "")
    TARGET_TAG="$(latest_release)"
    [ -n "$TARGET_TAG" ] || die "could not determine the latest release from GitHub"
    ;;
  *)
    TARGET_TAG="$1"
    ;;
esac

if [ "$TARGET_TAG" = "$CURRENT_TAG" ] && [ "${1:-}" != "--rollback" ]; then
  log "Already running $CURRENT_TAG — nothing to do."
  exit 0
fi

log "Deploying $TARGET_TAG (currently $([ -n "$CURRENT_TAG" ] && echo "$CURRENT_TAG" || echo "unknown"))"
export RELEASE_TAG="$TARGET_TAG"
export GHCR_OWNER="${GHCR_OWNER:-matealv}"

# ---------------------------------------------------------------------------
# Back up the database before anything restarts.
# ---------------------------------------------------------------------------
if [ "${SKIP_BACKUP:-0}" != "1" ]; then
  backup="$STATE_DIR/backups/pre-$TARGET_TAG-$(date +%Y%m%dT%H%M%S).sql.gz"
  mkdir -p "$(dirname "$backup")"
  log "Backing up the database to $backup"
  # A migration runs on every backend boot; this is the only way back from one
  # that goes wrong.
  if "${COMPOSE[@]}" exec -T db pg_dump -U "${POSTGRES_USER:-postgres}" \
       "${POSTGRES_DB:-diagnosticar}" 2>/dev/null | gzip > "$backup"; then
    log "Backup written ($(du -h "$backup" | cut -f1))"
    # Keep a month of pre-deploy snapshots.
    find "$STATE_DIR/backups" -name 'pre-*.sql.gz' -mtime +30 -delete 2>/dev/null || true
  else
    rm -f "$backup"
    die "database backup failed — refusing to deploy"
  fi
fi

# ---------------------------------------------------------------------------
# Pull first, so a registry problem fails before anything is torn down.
# ---------------------------------------------------------------------------
log "Pulling images for $TARGET_TAG"
"${COMPOSE[@]}" pull backend frontend || die "image pull failed for $TARGET_TAG"

log "Starting the stack"
"${COMPOSE[@]}" up -d --no-build --remove-orphans || die "compose up failed"

# ---------------------------------------------------------------------------
# Verify, and undo if the new release is not healthy.
# ---------------------------------------------------------------------------
log "Running smoke tests"
if ops/smoke.sh; then
  log "Smoke tests passed — $TARGET_TAG is live"
  [ -n "$CURRENT_TAG" ] && echo "$CURRENT_TAG" > "$PREVIOUS_FILE"
  echo "$TARGET_TAG" > "$CURRENT_FILE"
  "${COMPOSE[@]}" ps
  # Reclaim space from superseded images, keeping the rollback target.
  docker image prune -f --filter "until=720h" >/dev/null 2>&1 || true
  exit 0
fi

log "Smoke tests FAILED for $TARGET_TAG"
"${COMPOSE[@]}" logs --tail 100 backend frontend || true

if [ -z "$CURRENT_TAG" ]; then
  die "no known-good tag to roll back to; the stack is running $TARGET_TAG and is unhealthy"
fi

log "Rolling back to $CURRENT_TAG"
export RELEASE_TAG="$CURRENT_TAG"
"${COMPOSE[@]}" up -d --no-build || die "ROLLBACK FAILED — manual intervention required"

if ops/smoke.sh; then
  log "Rollback to $CURRENT_TAG succeeded. $TARGET_TAG was not deployed."
  exit 1
fi
die "ROLLBACK FAILED smoke tests — the site is down, manual intervention required"
