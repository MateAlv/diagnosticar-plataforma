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

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

COMPOSE=(docker compose -p diagnosticar-staging --env-file "$ENV_FILE"
         -f docker-compose.yml -f docker-compose.staging.yml)

case "${1:-up}" in
  up)
    if [ -n "${2:-}" ]; then
      export RELEASE_TAG="$2"
      COMPOSE+=(-f docker-compose.deploy.yml)
      "${COMPOSE[@]}" pull backend frontend
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
    SMOKE_FRONTEND_URL="https://${STAGING_HOST}" \
    SMOKE_BACKEND_URL="https://${STAGING_HOST}" \
      "$REPO_ROOT/ops/smoke.sh"
    ;;
  reset-db)
    # Safe by construction: only ever touches the staging project's volume.
    read -rp "Wipe the STAGING database? [y/N] " confirm
    [ "$confirm" = "y" ] || exit 0
    "${COMPOSE[@]}" down -v
    "${COMPOSE[@]}" up -d
    echo "Staging database recreated empty; migrations run on backend boot."
    ;;
  *)
    echo "usage: ops/staging.sh {up [TAG]|down|logs|ps|smoke|reset-db}" >&2
    exit 1
    ;;
esac
