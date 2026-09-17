#!/usr/bin/env bash
# Generates .env.staging from the example, filling in the values that should be
# random and leaving the ones only a person can supply.
#
#   ops/make-staging-env.sh
#
# Writes .env.staging in the repo root, which is gitignored. The JWT secrets are
# generated here rather than copied from anywhere: staging must never share
# production's, or a staging session would authenticate against production.
#
# Two values are left as CHANGE-ME because this script cannot know them:
#   STAGING_BASIC_AUTH  — an htpasswd hash; the command is printed below
#   SMTP_*              — deliberately unset, so no test run can email a real person
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TARGET="${1:-$REPO_ROOT/.env.staging}"
EXAMPLE="$REPO_ROOT/.env.staging.example"

[ -f "$EXAMPLE" ] || { echo "Missing $EXAMPLE" >&2; exit 1; }

if [ -e "$TARGET" ]; then
  echo "$TARGET already exists — refusing to overwrite it." >&2
  echo "Delete it first if you really want a fresh one." >&2
  exit 1
fi

secret() { openssl rand -hex 32; }
# `tr -dc ... </dev/urandom | head -c` deadlocks against set -e: tr keeps
# reading after head exits and dies on SIGPIPE, taking the script with it.
# Take a bounded slice of input instead so nothing outlives the pipe.
dbpass() { LC_ALL=C head -c 256 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c1-32; }

ACCESS_SECRET="$(secret)"
REFRESH_SECRET="$(secret)"
DB_PASSWORD="$(dbpass)"

sed \
  -e "s|^STAGING_JWT_ACCESS_SECRET=.*|STAGING_JWT_ACCESS_SECRET=${ACCESS_SECRET}|" \
  -e "s|^STAGING_JWT_REFRESH_SECRET=.*|STAGING_JWT_REFRESH_SECRET=${REFRESH_SECRET}|" \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${DB_PASSWORD}|" \
  -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://diagnosticar:${DB_PASSWORD}@db:5432/diagnosticar|" \
  "$EXAMPLE" > "$TARGET"

chmod 600 "$TARGET"

echo "Wrote $TARGET (mode 600, gitignored)."
echo
echo "Generated: both JWT secrets and the Postgres password."
echo "They are distinct from production's, which is the point — a staging"
echo "session must not be able to authenticate against production."
echo
echo "Still to fill in by hand:"
echo
echo "  STAGING_BASIC_AUTH   keeps staging off the public internet. Generate with:"
echo "      htpasswd -nb equipo 'a-strong-password' | sed -e 's/\\\$/\\\$\\\$/g'"
echo
echo "  STAGING_HOST         defaults to the value in the example; change it if"
echo "                       the DNS record differs."
echo
grep -n 'CHANGE-ME\|REPLACE' "$TARGET" || echo "  (nothing else marked CHANGE-ME)"
