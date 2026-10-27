#!/usr/bin/env bash
# Adds to production's .env what the services that used to run on brainy need,
# without touching any key already there and without printing any value.
#
#   ops/make-production-env.sh [path/to/.env]
#
# Generates: the RS256 pair the backend signs sessions with and hpo-recognizer
# verifies them with, the question agent's internal token, and Traefik's
# address for TRUSTED_PROXIES. Leaves for a person: the Claude credential.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-$REPO_ROOT/.env}"

[ -f "$TARGET" ] || { echo "Missing $TARGET — copy production's .env here first (PRODUCTION.md, step 1)." >&2; exit 1; }
case "$TARGET" in
  *.env.staging) echo "REFUSING: $TARGET is staging's." >&2; exit 1 ;;
esac

umask 077
chmod 600 "$TARGET"

has() { grep -q "^$1=." "$TARGET"; }

added=()
add() {
  if has "$1"; then
    echo "  kept    $1 (already set)"
  else
    printf '%s=%s\n' "$1" "$2" >> "$TARGET"
    added+=("$1")
    echo "  added   $1"
  fi
}

# Newlines become literal \n: an .env value is one line, and the backend
# (readMultilineEnv) and the gateway both unescape them.
one_line() { awk 'BEGIN { ORS = "\\n" } { print }' "$1" | sed 's/\\n$//'; }

if has JWT_ACCESS_PRIVATE_KEY || has JWT_ACCESS_PUBLIC_KEY; then
  echo "  kept    JWT_ACCESS_PRIVATE_KEY / JWT_ACCESS_PUBLIC_KEY (already set)"
else
  dir="$(mktemp -d)"
  trap 'rm -rf "$dir"' EXIT
  openssl genrsa -out "$dir/private.pem" 2048 2> /dev/null
  openssl rsa -in "$dir/private.pem" -pubout -out "$dir/public.pem" 2> /dev/null
  add JWT_ACCESS_PRIVATE_KEY "$(one_line "$dir/private.pem")"
  add JWT_ACCESS_PUBLIC_KEY "$(one_line "$dir/public.pem")"
fi

# Sessions open before the first deploy hold HS256 tokens. Accepting them for
# one access-token lifetime (15 min) keeps those people signed in; set it to
# false after that (PRODUCTION.md, step 6).
add JWT_ACCEPT_LEGACY_HS256 true

add QUESTION_AGENT_URL http://question-agent:8010
add QUESTION_AGENT_TOKEN "$(openssl rand -hex 32)"

# Traefik's own address, never the network's CIDR: other teams' containers
# share that network, and trusting them lets any of them forge X-Forwarded-For.
traefik_ip="$(docker inspect traefik_nodo0 \
  -f '{{with index .NetworkSettings.Networks "internal-nodo0-web"}}{{.IPAddress}}{{end}}' 2> /dev/null || true)"
if [ -n "$traefik_ip" ]; then
  add TRUSTED_PROXIES "$traefik_ip"
elif ! has TRUSTED_PROXIES; then
  echo "  MISSING TRUSTED_PROXIES: traefik_nodo0 not found; set it to Traefik's address on internal-nodo0-web."
fi

echo
echo "Added ${#added[@]} key(s) to $TARGET (mode 600)."
if ! has CLAUDE_CODE_OAUTH_TOKEN && ! has ANTHROPIC_API_KEY; then
  echo
  echo "Still to add by hand, one of:"
  echo "  CLAUDE_CODE_OAUTH_TOKEN=...   from \`claude setup-token\` (a subscription, as staging)"
  echo "  ANTHROPIC_API_KEY=...         an organisation key, with RECOGNIZER_PROVIDER=anthropic"
  echo "                                and PREGUNTAS_LLM_PROVIDER=anthropic"
fi
