#!/usr/bin/env bash
# Runs on the instance as /usr/local/bin/diagnosticar. Installed by user_data,
# replaced by itself on every deploy, and driven from a laptop through
# ../scripts/remote.sh (SSM Run Command), so nobody needs a shell for routine
# work.
#
#   diagnosticar deploy              sync the stack, write .env, pull, up
#   diagnosticar status              containers, memory, and the three healthz
#   diagnosticar logs [service]      last 200 lines
#   diagnosticar stats               docker stats + free, for sizing the instance
#   diagnosticar seed-admin <email>  make an account that signed up on the web an admin
#   diagnosticar backup              pg_dump to s3://$BUCKET/backups/
#
# Never prints a secret: .env is written mode 600 and only its key names are
# ever shown. Run Command keeps a command's output in the account, so nothing
# here may write one to stdout, ever.
set -euo pipefail

# BUCKET and AWS_REGION, written by user_data. Ours, so sourcing is safe.
# shellcheck source=/dev/null
. /etc/diagnosticar/instance.env
export AWS_DEFAULT_REGION="$AWS_REGION"

ROOT=/opt/diagnosticar
COMPOSE=(docker compose --project-directory "$ROOT" -f "$ROOT/docker-compose.yml" --env-file "$ROOT/.env")

log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

env_value() { sed -n "s/^$1='\(.*\)'$/\1/p" "$ROOT/.env" | head -1; }

sync_stack() {
    log "Syncing the stack from s3://$BUCKET"
    mkdir -p "$ROOT/data"
    aws s3 sync --only-show-errors "s3://$BUCKET/stack/" "$ROOT/" \
        --exclude ".env" --exclude "data/*"
    aws s3 sync --only-show-errors "s3://$BUCKET/data/" "$ROOT/data/"
    chmod +x "$ROOT/ops/seed-admin.sh"
    install -m 755 "$ROOT/diagnosticar.sh" /usr/local/bin/diagnosticar
    [ -s "$ROOT/data/genes.db" ] \
        || die "genes.db is not in s3://$BUCKET/data/ (infra/aws/README.md, phase 2)"
}

# Every parameter under /diagnosticar becomes NAME='value', NAME being its last
# path segment. Single quotes make compose take the value literally, which is
# what the PEM keys with their \n escapes need.
render_env() {
    log "Writing .env from SSM"
    local tmp
    tmp=$(mktemp "$ROOT/.env.XXXXXX")
    chmod 600 "$tmp"
    aws ssm get-parameters-by-path --path /diagnosticar --recursive --with-decryption \
        --query 'Parameters[].[Name,Value]' --output json \
    | python3 -c '
import json, re, sys
seen = {}
for name, value in json.load(sys.stdin):
    key = name.rsplit("/", 1)[-1]
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
        sys.exit(f"bad parameter name: {name}")
    if key in seen:
        sys.exit(f"{key} is defined twice: {seen[key]} and {name}")
    if "\x27" in value or "\n" in value:
        sys.exit(f"{name} holds a quote or a newline; store it on one line")
    # A secret not generated yet (the Anthropic key) is stored as PLACEHOLDER,
    # since SSM cannot hold an empty string.
    if value == "PLACEHOLDER":
        value = ""
    seen[key] = name
    print(f"{key}=\x27{value}\x27")
' > "$tmp"
    mv "$tmp" "$ROOT/.env"
    echo "    keys: $(cut -d= -f1 "$ROOT/.env" | tr '\n' ' ')"
}

ecr_login() {
    local registry
    registry=$(env_value ECR_REGISTRY)
    aws ecr get-login-password | docker login --username AWS --password-stdin "$registry" >/dev/null
}

# docker login leaves the registry token in /root/.docker/config.json; it is
# only needed for the pull.
ecr_logout() {
    docker logout "$(env_value ECR_REGISTRY)" >/dev/null 2>&1 || true
}

cmd_deploy() {
    # Two repositories can merge at the same time; their deploys take turns.
    exec 9>/run/diagnosticar-deploy.lock
    flock 9
    sync_stack
    render_env
    local tag
    tag=$(env_value IMAGE_TAG)
    if [ -z "$tag" ] || [ "$tag" = "none" ]; then
        log "No images pushed yet (IMAGE_TAG=none). Run infra/aws/scripts/push-images.sh, then deploy again."
        return 0
    fi
    log "Deploying $tag"
    ecr_login
    if ! "${COMPOSE[@]}" pull --quiet; then
        ecr_logout
        die "pulling the images failed"
    fi
    ecr_logout
    "${COMPOSE[@]}" up -d --remove-orphans
    # Only dangling layers: the previous release's images stay for a rollback.
    docker image prune -f >/dev/null
    "${COMPOSE[@]}" ps
}

healthz() {
    local domain path
    domain=$(env_value DOMAIN)
    for path in /api/health /genphenai/healthz /hpo-api/healthz; do
        printf '%-20s ' "$path"
        curl -s --max-time 10 --resolve "$domain:443:127.0.0.1" "https://$domain$path" \
            || printf '(no answer)'
        echo
    done
}

cmd_status() {
    "${COMPOSE[@]}" ps
    echo
    free -m
    echo
    healthz
}

cmd_logs() {
    "${COMPOSE[@]}" logs --tail 200 --no-color "$@"
}

cmd_stats() {
    docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}'
    echo
    free -m
}

# Promotes an account that already signed up through the web, with a password
# its owner chose there. Deliberately never --create: that mode prints a
# temporary password, and this output is kept by Run Command.
cmd_seed_admin() {
    [ -n "${1:-}" ] || die "usage: diagnosticar seed-admin <email>  (sign up on the web first)"
    cd "$ROOT"
    COMPOSE_PROJECT=diagnosticar ENV_FILE="$ROOT/.env" ops/seed-admin.sh "$1"
}

cmd_backup() {
    local key
    key="backups/diagnosticar-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
    "${COMPOSE[@]}" exec -T db pg_dump -U diagnosticar -d diagnosticar \
        | gzip -9 \
        | aws s3 cp --only-show-errors - "s3://$BUCKET/$key"
    log "Saved s3://$BUCKET/$key"
}

case "${1:-}" in
    deploy)     cmd_deploy ;;
    status)     cmd_status ;;
    logs)       shift; cmd_logs "$@" ;;
    stats)      cmd_stats ;;
    seed-admin) shift; cmd_seed_admin "$@" ;;
    backup)     cmd_backup ;;
    *)          sed -n '2,14p' "$0"; exit 1 ;;
esac
