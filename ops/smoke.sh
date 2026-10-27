#!/usr/bin/env bash
# Post-deploy health gate for the nodo0 stack.
#
# Deliberately checks behaviour, not just "did the container start". A container
# that boots with a broken database connection, a missing security header, or an
# accidentally public patients endpoint is a failed deploy, and deploy.sh rolls
# back when this script exits non-zero.
#
# Usage: ops/smoke.sh [frontend_url] [backend_url]
set -euo pipefail

FRONTEND_URL="${1:-${SMOKE_FRONTEND_URL:-http://127.0.0.1:3000}}"
BACKEND_URL="${2:-${SMOKE_BACKEND_URL:-http://127.0.0.1:4000}}"

# Where /health lives depends on how the backend is reached. Straight at the
# container it is /health; behind Traefik the router matches PathPrefix(`/api`),
# so anything outside /api never reaches the backend at all. Callers that go
# through the proxy set SMOKE_HEALTH_PATH=/api/health.
HEALTH_PATH="${SMOKE_HEALTH_PATH:-/health}"
TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-90}"
# hpo-recognizer loads the HPO index and warms the extractor before it listens:
# 58 s on nodo0 on 2026-10-27, against the backend's 1 s.
MODEL_TIMEOUT_SECONDS="${SMOKE_MODEL_TIMEOUT_SECONDS:-240}"

# Staging sits behind Traefik basic auth, so every request there needs
# credentials — including /health. Without them each check reads 401 and the
# whole suite fails on a stack that is perfectly healthy. Production sets
# nothing and the array stays empty.
AUTH=()
if [ -n "${SMOKE_BASIC_AUTH:-}" ]; then
  AUTH=(-u "$SMOKE_BASIC_AUTH")
fi

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
ok()   { echo "  ok   $*"; }

wait_for() {
  local url=$1 name=$2 timeout=${3:-$TIMEOUT_SECONDS} i
  for ((i = 1; i <= timeout; i++)); do
    if curl -sf "${AUTH[@]}" -o /dev/null --max-time 5 "$url"; then
      ok "$name responded after ${i}s"
      return 0
    fi
    sleep 1
  done
  fail "$name never responded at $url within ${timeout}s"
}

echo "==> Availability"
wait_for "$BACKEND_URL$HEALTH_PATH" "backend $HEALTH_PATH"
wait_for "$FRONTEND_URL/home"  "frontend /home"

echo "==> Backend health reports a reachable database"
health=$(curl -sf "${AUTH[@]}" --max-time 5 "$BACKEND_URL$HEALTH_PATH")
echo "$health" | grep -q '"status":"ok"' \
  || fail "backend health is not ok: $health"
ok "database reachable"

echo "==> Patient data is not publicly readable"
# The single most important post-deploy assertion: this endpoint returns other
# families' clinical records if authentication regresses.
code=$(curl -s "${AUTH[@]}" -o /dev/null -w '%{http_code}' --max-time 5 "$BACKEND_URL/api/patients")
[ "$code" = "401" ] || fail "GET /api/patients returned $code, expected 401"
ok "unauthenticated read rejected"

echo "==> Cross-origin writes are rejected"
code=$(curl -s "${AUTH[@]}" -o /dev/null -w '%{http_code}' --max-time 5 \
  -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' \
  -d '{}' "$BACKEND_URL/api/patients")
[ "$code" = "403" ] || fail "cross-origin POST returned $code, expected 403"
ok "foreign origin rejected"

echo "==> Frontend security headers"
headers=$(curl -sI "${AUTH[@]}" --max-time 5 "$FRONTEND_URL/home")
for header in X-Frame-Options X-Content-Type-Options Referrer-Policy \
              Permissions-Policy Strict-Transport-Security; do
  echo "$headers" | grep -qi "^${header}:" || fail "missing $header"
  ok "$header present"
done
echo "$headers" | grep -qi '^X-Powered-By:' && fail "X-Powered-By is exposed"
ok "X-Powered-By absent"

echo "==> Landing page actually renders"
body=$(curl -sf "${AUTH[@]}" --max-time 10 "$FRONTEND_URL/home")
echo "$body" | grep -q 'Diagnostic.ar' || fail "/home did not contain the product name"
# Mojibake here means a charset regression between the build and the proxy.
echo "$body" | grep -q 'Ã©\|Ã³\|â€' && fail "/home contains mojibake — check charset handling"
ok "landing page renders"

# The model services live on the same public host as the frontend on nodo0.
# Locally they are usually not running, so the check is opt-in.
if [ "${SMOKE_MODEL_SERVICES:-false}" = true ]; then
  echo "==> Model services answer on this host"
  wait_for "$FRONTEND_URL/hpo-api/healthz" "/hpo-api" "$MODEL_TIMEOUT_SECONDS"
  wait_for "$FRONTEND_URL/genphenai/healthz" "/genphenai" "$MODEL_TIMEOUT_SECONDS"
  body=$(curl -sf "${AUTH[@]}" --max-time 10 "$FRONTEND_URL/hpo-api/hpo/es/search?q=convulsiones&limit=3") \
    || fail "/hpo-api symptom search did not answer"
  echo "$body" | grep -q '"HP:0001250"' || fail "symptom search did not find Seizure: $body"
  ok "symptom search"
  body=$(curl -sf "${AUTH[@]}" --max-time 10 "$FRONTEND_URL/hpo-api/healthz") \
    || fail "/hpo-api/healthz did not answer"
  echo "$body" | grep -Eq '"ready": *true' || fail "symptom extraction is not ready: $body"
  ok "symptom extraction ready"
  body=$(curl -sf "${AUTH[@]}" --max-time 10 "$FRONTEND_URL/genphenai/healthz") \
    || fail "/genphenai/healthz did not answer"
  echo "$body" | grep -Eq '"status": *"ok"' || fail "gene ranking is not ok: $body"
  ok "gene ranking ($(echo "$body" | grep -Eo '"release": *"[^"]*"' | head -1))"
fi

echo
echo "SMOKE PASS"
