#!/usr/bin/env bash
# Run every CI check on this machine, in CI's own order.
#
# `make test` only covers five of the eleven checks in .github/workflows/ci.yml.
# The image builds, the dependency audits, the secret scan and the compose
# stack smoke test are not exercised by it at all — which is how a frontend
# image that does not build reaches a pull request with a green local run
# behind it. GitHub Actions minutes are a paid, finite resource; burning them
# to discover a broken Docker build is waste.
#
#   ops/ci-local.sh            # everything, stopping at the first failure
#   ops/ci-local.sh images     # one group: lint typecheck unit backend e2e
#                              #            audit secrets images stack
#   KEEP_GOING=1 ops/ci-local.sh   # run all groups, report at the end
#
# It is deliberately the same commands CI runs rather than a summary of them:
# a local gate that is merely similar teaches you a build passes when it does
# not.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

KEEP_GOING="${KEEP_GOING:-}"
FAILED=()
PASSED=()
SKIPPED=()

# The values CI passes to the frontend image build. They must be present and
# must not be real: the frontend compiles NEXT_PUBLIC_* in at build time, so a
# production URL here would bake production into a test image.
readonly BUILD_ARGS=(
    --build-arg NEXT_PUBLIC_API_URL=https://example.invalid/api
    --build-arg NEXT_PUBLIC_API_BASE_URL=https://example.invalid/api
    --build-arg NEXT_PUBLIC_HPO_API_URL=https://example.invalid/hpo-api
    --build-arg NEXT_PUBLIC_GENPHENAI_URL=https://example.invalid/genphenai
)

say() { printf '\n\033[1m=== %s\033[0m\n' "$*"; }

run() {
    local name="$1"; shift
    say "$name"
    if "$@"; then
        PASSED+=("$name")
        return 0
    fi
    FAILED+=("$name")
    printf '\033[31mFAIL: %s\033[0m\n' "$name"
    [ -n "$KEEP_GOING" ] && return 0
    return 1
}

# --- the groups ------------------------------------------------------------

group_lint() {
    run "Lint & typecheck (frontend)" bash -c 'cd frontend && npm run lint && npm run typecheck' || return 1
    run "Lint & typecheck (backend)"  bash -c 'cd backend  && npm run lint && npm run typecheck' || return 1
}

group_unit() {
    run "Frontend unit tests" bash -c 'cd frontend && npm test' || return 1
}

group_backend() {
    run "Backend tests (Postgres)" make test-backend || return 1
}

group_e2e() {
    run "E2E (Playwright)" make test-e2e || return 1
}

group_audit() {
    # Runtime findings gate; dev-only findings are informational in CI, so they
    # are not run here at all rather than reported as a failure they are not.
    run "Dependency audit (frontend)" bash -c \
        'cd frontend && npm audit --omit=dev --audit-level=high && npm ci --dry-run' || return 1
    run "Dependency audit (backend)" bash -c \
        'cd backend  && npm audit --omit=dev --audit-level=high && npm ci --dry-run' || return 1
}

group_secrets() {
    # gitleaks runs as a container action in CI. Locally it is optional, since
    # requiring it would make the whole gate unrunnable without a pull.
    if command -v gitleaks >/dev/null 2>&1; then
        run "Secret scan (gitleaks)" gitleaks detect --no-banner --redact || return 1
    elif docker image inspect zricethezav/gitleaks:latest >/dev/null 2>&1; then
        run "Secret scan (gitleaks)" docker run --rm -v "$REPO_ROOT:/repo" \
            zricethezav/gitleaks:latest detect -s /repo --no-banner --redact || return 1
    else
        SKIPPED+=("Secret scan (gitleaks not installed — CI still runs it)")
    fi

    run "No .env file is tracked" bash -c '
        tracked=$(git ls-files | grep -E "(^|/)\.env(\.[A-Za-z0-9_-]+)*$" | grep -v "\.example$" || true)
        if [ -n "$tracked" ]; then echo "Environment files are committed: $tracked"; exit 1; fi
        echo "ok — no .env files tracked"' || return 1
}

build_and_check_image() {
    local workspace="$1" image="$2"
    local args=()
    [ "$workspace" = "frontend" ] && args=("${BUILD_ARGS[@]}")

    # --pull keeps the base image current, but not --no-cache: `npm ci` installs
    # exactly what the lockfile pins, so a cached layer cannot hold a different
    # dependency tree from a fresh one. Forcing a rebuild every run just wrote
    # another ~800 MB copy of node_modules, and filled a laptop doing it.
    #
    # One fixed tag per image, reused every run, for the same reason: a new tag
    # per iteration orphans the previous image as dangling layers.
    docker build --pull "${args[@]}" \
        -t "${image}:ci" "./${workspace}" || return 1

    local user
    user=$(docker image inspect "${image}:ci" --format '{{.Config.User}}')
    if [ -z "$user" ] || [ "$user" = "root" ] || [ "$user" = "0" ]; then
        echo "${image} runs as root; add a USER directive to its Dockerfile."
        return 1
    fi
    echo "ok — runs as $user"

    if docker image inspect aquasec/trivy:latest >/dev/null 2>&1 || command -v trivy >/dev/null 2>&1; then
        if command -v trivy >/dev/null 2>&1; then
            trivy image --exit-code 1 --ignore-unfixed \
                --severity HIGH,CRITICAL --vuln-type os,library "${image}:ci" || return 1
        else
            docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
                aquasec/trivy:latest image --exit-code 1 --ignore-unfixed \
                --severity HIGH,CRITICAL --vuln-type os,library "${image}:ci" || return 1
        fi
    else
        echo "note: trivy not installed, skipping the vulnerability scan (CI still runs it)"
    fi
}

group_images() {
    run "Build & scan images (frontend)" build_and_check_image frontend diagnosticar-frontend || return 1
    run "Build & scan images (backend)"  build_and_check_image backend  diagnosticar-backend  || return 1
}

stack_smoke() {
    # CI writes a .env for this job. Ours goes to a temp file and the real .env
    # is never touched: on a dev box it holds working credentials.
    #
    # The ports are moved off the defaults too. A CI runner is empty, but a dev
    # box usually has Postgres on 5432 and often the project's own stack on
    # 3000/4000, and a bind conflict there would read as a failing check rather
    # than as a busy machine.
    local db_port=${CI_DB_PORT:-55433}
    local backend_port=${CI_BACKEND_PORT:-54000}
    local frontend_port=${CI_FRONTEND_PORT:-53000}

    local env_file
    env_file="$(mktemp)"
    cat > "$env_file" <<EOF
POSTGRES_USER=diagnosticar
POSTGRES_PASSWORD=ci-only-password
POSTGRES_DB=diagnosticar
DATABASE_URL=postgresql://diagnosticar:ci-only-password@db:5432/diagnosticar
JWT_ACCESS_SECRET=ci-access-secret-that-is-at-least-32-chars
JWT_REFRESH_SECRET=ci-refresh-secret-that-is-at-least-32-chars
FRONTEND_URL=http://localhost:${frontend_port}
BACKEND_URL=http://localhost:${backend_port}
NODE_ENV=production
DB_PORT=${db_port}
BACKEND_PORT=${backend_port}
BACKEND_BIND_IP=127.0.0.1
FRONTEND_PORT=${frontend_port}
FRONTEND_BIND_IP=127.0.0.1
EOF

    local project=diagnosticar-cilocal
    local compose=(docker compose -p "$project" --env-file "$env_file")
    local status=0

    "${compose[@]}" -f docker-compose.yml -f docker-compose.prod.yml config >/dev/null || status=1

    if [ $status -eq 0 ]; then
        "${compose[@]}" up --build -d db backend frontend || status=1
    fi

    if [ $status -eq 0 ]; then
        local i
        for i in $(seq 1 60); do
            curl -sf "http://127.0.0.1:${backend_port}/health" 2>/dev/null | grep -q '"status":"ok"' && break
            [ "$i" = 60 ] && { echo "backend never became healthy"; "${compose[@]}" logs backend db; status=1; }
            sleep 1
        done
    fi

    if [ $status -eq 0 ]; then
        for i in $(seq 1 60); do
            curl -sf -o /dev/null "http://127.0.0.1:${frontend_port}/home" 2>/dev/null && break
            [ "$i" = 60 ] && { echo "frontend never served /home"; "${compose[@]}" logs frontend; status=1; }
            sleep 1
        done
    fi

    # migrate() runs on every boot, so a non-idempotent statement breaks the
    # second deploy rather than the first.
    if [ $status -eq 0 ]; then
        "${compose[@]}" restart backend
        local ok=1
        for i in $(seq 1 60); do
            curl -sf "http://127.0.0.1:${backend_port}/health" 2>/dev/null | grep -q '"status":"ok"' && { ok=0; break; }
            sleep 1
        done
        [ $ok -eq 0 ] || { echo "backend failed to restart — migrations may not be idempotent"; status=1; }
    fi

    # Always tear our own project down. This is a throwaway project name, never
    # `diagnosticar` or `diagnosticar-staging`, so it cannot touch real data.
    "${compose[@]}" down -v >/dev/null 2>&1
    rm -f "$env_file"
    return $status
}

group_stack() {
    run "Compose stack smoke test" stack_smoke || return 1
}

# --- driver ----------------------------------------------------------------

ALL_GROUPS=(lint unit backend e2e audit secrets images stack)
groups=("${@:-}")
[ -z "${groups[*]}" ] && groups=("${ALL_GROUPS[@]}")

started=$SECONDS
for g in "${groups[@]}"; do
    if ! declare -F "group_${g}" >/dev/null; then
        echo "unknown group '${g}'; choose from: ${ALL_GROUPS[*]}" >&2
        exit 2
    fi
    "group_${g}" || break
done

printf '\n\033[1m=== summary (%dm%02ds)\033[0m\n' $(( (SECONDS-started)/60 )) $(( (SECONDS-started)%60 ))
for name in "${PASSED[@]:-}";  do [ -n "$name" ] && printf '  \033[32mpass\033[0m  %s\n' "$name"; done
for name in "${SKIPPED[@]:-}"; do [ -n "$name" ] && printf '  skip  %s\n' "$name"; done
for name in "${FAILED[@]:-}";  do [ -n "$name" ] && printf '  \033[31mFAIL\033[0m  %s\n' "$name"; done

if [ "${#FAILED[@]}" -gt 0 ]; then
    printf '\n\033[31m%d check(s) failed — do not push.\033[0m\n' "${#FAILED[@]}"
    exit 1
fi
printf '\n\033[32mAll checks passed.\033[0m\n'
