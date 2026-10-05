#!/usr/bin/env bash
# Runs on the machine as /usr/local/bin/diagnosticar, the same on every
# provider. Installed by cloud-init, replaced by `install-stack`, and driven
# from a laptop with infra/cloud/scripts/remote.sh (over SSH), or by systemd
# (deploy every 5 minutes, backup every night).
#
#   diagnosticar deploy [--force]        pull the channel; apply if it changed; roll back if it fails
#   diagnosticar rollback                go back to the images that ran before
#   diagnosticar status                  containers, memory, health, last deploy
#   diagnosticar logs [service]          last 200 lines
#   diagnosticar stats                   docker stats + free, for sizing the machine
#   diagnosticar seed-admin <email>      make an account that signed up on the web an admin
#   diagnosticar backup                  pg_dump, kept here and copied to BACKUP_REMOTE
#   diagnosticar restore --yes <file|latest|->   replace the database with a dump
#   diagnosticar init-secrets            generate whatever secret is missing (first boot)
#   diagnosticar set-secret NAME         read one secret from standard input
#   diagnosticar rotate NAME             replace a JWT secret (signs everyone out)
#   diagnosticar secrets                 which secrets exist (names only)
#   diagnosticar install-genes           read genes.db from standard input, check it, install it
#   diagnosticar install-stack           read a new stack (tar.gz) from standard input, then deploy
#
# Never prints a secret: secrets.env and .env are mode 600 and only key names
# are ever shown.
set -euo pipefail

ROOT=/opt/diagnosticar
ETC=/etc/diagnosticar
STATE=/var/lib/diagnosticar
BACKUPS=/var/backups/diagnosticar
CONFIG=$ETC/config.env
SECRETS=$ETC/secrets.env
IMAGES=$STATE/images.env
PREVIOUS=$STATE/images.previous.env
REJECTED=$STATE/images.rejected.env
STATUS_FILE=$ROOT/status/deploy-status.json

SERVICES=(backend frontend hpo-recognizer model)
COMPOSE=(docker compose --project-directory "$ROOT" -f "$ROOT/docker-compose.yml" --env-file "$ROOT/.env")

# Secrets set by hand; everything else in secrets.env is generated here.
SETTABLE="REGISTRY_USERNAME REGISTRY_TOKEN CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY BACKUP_REMOTE_SECRET"

log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# --- KEY='value' files ----------------------------------------------------------
# Single quotes make compose take a value literally, which is what the PEM keys
# with their \n escapes need. A value may hold neither a quote nor a newline.

kv_get() {  # kv_get FILE KEY
    [ -f "$1" ] || return 0
    sed -n "s/^$2='\(.*\)'$/\1/p" "$1" | tail -1
}

kv_set() {  # kv_set FILE KEY VALUE
    case "$3" in *"'"*|*$'\n'*) die "$2 holds a quote or a newline; store it on one line" ;; esac
    local tmp
    tmp=$(mktemp "$1.XXXXXX")
    chmod 600 "$tmp"
    { grep -v "^$2=" "$1" 2>/dev/null || true; printf "%s='%s'\n" "$2" "$3"; } > "$tmp"
    mv "$tmp" "$1"
}

conf() { kv_get "$CONFIG" "$1"; }

image_var() {
    case "$1" in
        backend)        echo BACKEND_IMAGE ;;
        frontend)       echo FRONTEND_IMAGE ;;
        hpo-recognizer) echo RECOGNIZER_IMAGE ;;
        model)          echo MODEL_IMAGE ;;
    esac
}

# --- The domain -------------------------------------------------------------------
# DOMAIN in config.env, or "auto": <public-ip-with-dashes>.sslip.io, which
# resolves to that address with no DNS to manage and is accepted by Let's
# Encrypt. Detected once and remembered; `deploy --force` detects it again.

public_ip() {
    local url ip
    for url in https://checkip.amazonaws.com https://api.ipify.org https://ifconfig.me/ip; do
        ip=$(curl -4 -fsS --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]') || continue
        [[ "$ip" =~ ^[0-9]+(\.[0-9]+){3}$ ]] && { echo "$ip"; return 0; }
    done
    return 1
}

domain() {
    local d ip
    d=$(conf DOMAIN)
    if [ -n "$d" ] && [ "$d" != auto ]; then echo "$d"; return; fi
    if [ -s "$STATE/domain" ] && [ -z "${REDETECT:-}" ]; then cat "$STATE/domain"; return; fi
    ip=$(public_ip) || die "could not find this machine's public IP; set DOMAIN in $CONFIG"
    mkdir -p "$STATE"
    echo "${ip//./-}.sslip.io" | tee "$STATE/domain"
}

# --- .env -------------------------------------------------------------------------

render_env() {
    [ -s "$SECRETS" ] || die "no secrets yet: run diagnosticar init-secrets"
    local tmp d
    d=$(domain)
    tmp=$(mktemp "$ROOT/.env.XXXXXX")
    chmod 600 "$tmp"
    {
        grep -E "^[A-Z][A-Z0-9_]*='" "$CONFIG" | grep -v '^DOMAIN=' || true
        printf "DOMAIN='%s'\n" "$d"
        # Registry and backup credentials are for this tool, not for any container.
        grep -E "^[A-Z][A-Z0-9_]*='" "$SECRETS" | grep -v -E '^(REGISTRY_|BACKUP_)' || true
        if [ -s "$IMAGES" ]; then cat "$IMAGES"; fi
    } > "$tmp"
    mv "$tmp" "$ROOT/.env"
}

# --- Images -----------------------------------------------------------------------
# The registry token goes into a Docker config of its own in /run (RAM), used
# only for the pull and removed right after, so no login is left on disk.

registry_login() {
    local registry user token
    registry=$(conf REGISTRY)
    DOCKER_CONFIG=$(mktemp -d /run/diagnosticar-docker.XXXXXX)
    export DOCKER_CONFIG
    token=$(kv_get "$SECRETS" REGISTRY_TOKEN)
    user=$(kv_get "$SECRETS" REGISTRY_USERNAME)
    if [ -n "$token" ]; then
        printf '%s' "$token" | docker login "${registry%%/*}" -u "${user:-token}" --password-stdin >/dev/null 2>&1 \
            || { registry_logout; die "logging in to ${registry%%/*} failed: check REGISTRY_USERNAME and REGISTRY_TOKEN"; }
    fi
}

registry_logout() {
    [ -n "${DOCKER_CONFIG:-}" ] && rm -rf "$DOCKER_CONFIG"
    unset DOCKER_CONFIG
}

# Prints NAME_IMAGE='registry/repo@sha256:…' for every service, from the tag
# CHANNEL points to now.
resolve_channel() {
    local registry prefix channel svc ref digest
    registry=$(conf REGISTRY)
    prefix=$(conf IMAGE_PREFIX)
    channel=$(conf CHANNEL)
    for svc in "${SERVICES[@]}"; do
        ref="$registry/$prefix$svc:$channel"
        docker pull -q "$ref" >/dev/null || { echo "pulling $ref failed" >&2; return 1; }
        digest=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$ref" \
                 | grep "^$registry/$prefix$svc@" | head -1)
        [ -n "$digest" ] || { echo "no digest for $ref" >&2; return 1; }
        printf "%s='%s'\n" "$(image_var "$svc")" "$digest"
    done
}

# --- Checks -----------------------------------------------------------------------
# Inside the stack's own network, through the caddy container (busybox wget),
# so they do not depend on DNS or on the certificate being issued yet.

probe() {  # probe URL [JSON-BODY]
    if [ -n "${2:-}" ]; then
        "${COMPOSE[@]}" exec -T caddy wget -q -O - -T 20 \
            --header 'Content-Type: application/json' --post-data "$2" "$1"
    else
        "${COMPOSE[@]}" exec -T caddy wget -q -O - -T 10 "$1"
    fi
}

wait_for() {  # wait_for NAME URL PYTHON-CHECK — up to 5 minutes (the encoder loads slowly)
    local body
    for _ in $(seq 1 60); do
        body=$(probe "$2" 2>/dev/null || true)
        if printf '%s' "$body" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if ($3) else 1)" 2>/dev/null; then
            log "$1 healthy"
            return 0
        fi
        sleep 5
    done
    echo "    $1 not healthy: ${body:0:300}" >&2
    return 1
}

check_stack() {
    wait_for backend http://backend:4000/health 'd.get("status") == "ok"' || return 1
    wait_for model http://model:18020/healthz \
        'd.get("status") == "ok" and d.get("mode") == "in-process" and d.get("specialties_available")' || return 1
    # A ranking, end to end: the reference case of docs/CLOUD_DEPLOY.md.
    probe http://model:18020/rank-genes \
        '{"hpo_ids":["HP:0000957","HP:0001067","HP:0009737","HP:0000316"],"top_k":3}' \
    | python3 -c 'import json,sys; r=[g["gene_symbol"] for g in json.load(sys.stdin)["results"]]; print("    ranking:", r); sys.exit(0 if r else 1)' \
        || { echo "    rank-genes did not answer a ranking" >&2; return 1; }
    # ready may be false until the Claude token is set; the service must still
    # be up, with its HPO index loaded.
    wait_for recognizer http://hpo-recognizer:8000/healthz \
        'd.get("status") == "ok" and d.get("hpo_index_loaded")' || return 1
    for _ in $(seq 1 24); do
        if probe http://frontend:3000/home 2>/dev/null | grep -q 'Diagnostic.ar'; then
            log "frontend healthy"
            return 0
        fi
        sleep 5
    done
    echo "    frontend /home did not render" >&2
    return 1
}

write_status() {  # write_status RESULT MESSAGE
    mkdir -p "$(dirname "$STATUS_FILE")"
    local tmp
    tmp=$(mktemp "$STATUS_FILE.XXXXXX")
    python3 - "$1" "$2" "$IMAGES" > "$tmp" <<'PY'
import json, re, subprocess, sys, datetime
result, message, images = sys.argv[1:4]
running = {}
try:
    for line in open(images):
        m = re.match(r"^([A-Z_]+)_IMAGE='(.+)'$", line.strip())
        if not m:
            continue
        ref = m.group(2)
        rev = subprocess.run(
            ["docker", "image", "inspect", "--format",
             '{{ index .Config.Labels "org.opencontainers.image.revision" }}', ref],
            capture_output=True, text=True).stdout.strip()
        running[m.group(1).lower()] = {"digest": ref.split("@", 1)[-1], "revision": rev or None}
except FileNotFoundError:
    pass
print(json.dumps({
    "result": result,
    "message": message,
    "time": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "images": running,
}, indent=2))
PY
    chmod 644 "$tmp"
    mv "$tmp" "$STATUS_FILE"
}

# --- deploy / rollback ------------------------------------------------------------

apply_images() {  # apply_images FILE — make FILE the running set
    cp "$1" "$IMAGES.new"
    mv "$IMAGES.new" "$IMAGES"
    render_env
    "${COMPOSE[@]}" up -d --remove-orphans
}

cmd_deploy() {
    local force="" new
    [ "${1:-}" = --force ] && force=1
    # The timer and a hand-run deploy take turns.
    exec 9>/run/diagnosticar-deploy.lock
    flock -w 1800 9 || die "another deploy has been running for 30 minutes"
    mkdir -p "$STATE" "$ROOT/status"
    [ -s "$ROOT/docker-compose.yml" ] || die "the stack is not installed yet: remote.sh setup"
    [ -s "$ROOT/data/genes.db" ] || die "genes.db is not installed yet: remote.sh install-genes"

    registry_login
    new=$(mktemp)
    if ! resolve_channel > "$new"; then
        registry_logout
        rm -f "$new"
        die "could not resolve channel '$(conf CHANNEL)' (images not published yet, or no REGISTRY_TOKEN)"
    fi
    registry_logout

    if [ -z "$force" ] && [ -s "$IMAGES" ] && cmp -s "$new" "$IMAGES"; then
        rm -f "$new"
        return 0     # nothing new; the timer stays quiet
    fi
    if [ -z "$force" ] && [ -s "$REJECTED" ] && cmp -s "$new" "$REJECTED"; then
        rm -f "$new"
        return 0     # this exact set already failed; wait for a new one
    fi
    [ -n "$force" ] && REDETECT=1

    log "Deploying"
    sed 's/^/    /' "$new"
    if [ -s "$IMAGES" ]; then cp "$IMAGES" "$PREVIOUS"; fi
    if apply_images "$new" && check_stack; then
        rm -f "$new" "$REJECTED"
        docker image prune -f >/dev/null    # dangling layers only; the previous set stays
        write_status ok "deployed"
        log "Deployed"
        return 0
    fi

    cp "$new" "$REJECTED"
    rm -f "$new"
    if [ -s "$PREVIOUS" ] && ! cmp -s "$PREVIOUS" "$REJECTED"; then
        log "The new images failed their checks; going back to the previous ones"
        if apply_images "$PREVIOUS" && check_stack; then
            write_status rolled_back "the new images failed their checks; the previous ones are running"
        else
            write_status failed "the new images failed, and so did the previous ones"
        fi
    else
        write_status failed "the new images failed their checks and there is nothing to go back to"
    fi
    die "deploy failed (see: remote.sh logs)"
}

cmd_rollback() {
    exec 9>/run/diagnosticar-deploy.lock
    flock -w 1800 9 || die "another deploy is running"
    [ -s "$PREVIOUS" ] || die "no previous images to go back to"
    local current
    current=$(mktemp)
    cp "$IMAGES" "$current"
    # Pin the set being left so the timer does not bring it straight back.
    cp "$current" "$REJECTED"
    apply_images "$PREVIOUS"
    mv "$current" "$PREVIOUS"
    if check_stack; then write_status rolled_back "rolled back by hand"; else write_status failed "rolled back by hand, and the checks failed"; fi
}

# --- status, logs ------------------------------------------------------------------

cmd_status() {
    "${COMPOSE[@]}" ps 2>/dev/null || echo "(not running yet)"
    echo
    free -m
    echo
    df -h / | tail -1
    echo
    local d path
    d=$(domain)
    for path in /api/health /genphenai/healthz /hpo-api/healthz; do
        printf '%-20s ' "$path"
        curl -s --max-time 10 --resolve "$d:443:127.0.0.1" "https://$d$path" || printf '(no answer)'
        echo
    done
    echo
    if [ -f "$STATUS_FILE" ]; then cat "$STATUS_FILE"; else echo "(no deploy yet)"; fi
}

cmd_logs() { "${COMPOSE[@]}" logs --tail 200 --no-color "$@"; }

cmd_stats() {
    docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}'
    echo
    free -m
}

# Promotes an account that already signed up through the web, with a password
# its owner chose there. Deliberately never --create, which prints a password.
cmd_seed_admin() {
    [ -n "${1:-}" ] || die "usage: diagnosticar seed-admin <email>  (sign up on the web first)"
    COMPOSE_PROJECT=diagnosticar ENV_FILE="$ROOT/.env" "$ROOT/ops/seed-admin.sh" "$1"
}

# --- backups ---------------------------------------------------------------------
# Kept on the machine for BACKUP_KEEP_DAYS, and copied to a remote when one is
# set: any rclone remote (S3, GCS, Azure Blob, B2, R2, an SFTP server…), as a
# connection string so no rclone config file is needed. BACKUP_REMOTE (config)
# when the machine's own identity grants access (an AWS instance role);
# BACKUP_REMOTE_SECRET (secret, wins) when the string must carry credentials.
# rcat only writes: no permission to read or list what is there is needed.

cmd_backup() {
    local name file remote keep
    mkdir -p "$BACKUPS"
    chmod 700 "$BACKUPS"
    name="diagnosticar-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
    file="$BACKUPS/$name"
    "${COMPOSE[@]}" exec -T db pg_dump -U diagnosticar -d diagnosticar | gzip -9 > "$file.tmp"
    mv "$file.tmp" "$file"
    log "Saved $file ($(du -h "$file" | cut -f1))"
    keep=$(conf BACKUP_KEEP_DAYS)
    find "$BACKUPS" -name 'diagnosticar-*.sql.gz' -mtime +"${keep:-14}" -delete
    remote=$(kv_get "$SECRETS" BACKUP_REMOTE_SECRET)
    [ -n "$remote" ] || remote=$(conf BACKUP_REMOTE)
    if [ -n "$remote" ]; then
        # -q: rclone otherwise notes that it has no config file, which it does
        # not need (the remote is a connection string).
        rclone -q rcat "$remote/$name" < "$file"
        log "Copied to the backup remote"
    fi
}

# Our own timestamped names, so ls -t is safe here.
# shellcheck disable=SC2012
newest_backup() { ls -1t "$BACKUPS"/diagnosticar-*.sql.gz 2>/dev/null | head -1 || true; }

cmd_restore() {
    [ "${1:-}" = --yes ] || die "usage: diagnosticar restore --yes <file|latest|->  (replaces the whole database)"
    local src="${2:-}" dump
    [ -n "$src" ] || die "which dump? a file under $BACKUPS, 'latest', or '-' for standard input"
    dump=$(mktemp)
    case "$src" in
        -)      cat > "$dump" ;;
        latest) src=$(newest_backup)
                [ -n "$src" ] || die "no backups in $BACKUPS"
                cp "$src" "$dump" ;;
        *)      [ -f "$src" ] || die "no such file: $src"
                cp "$src" "$dump" ;;
    esac
    gzip -t "$dump" || { rm -f "$dump"; die "that is not a gzip'd dump"; }
    log "Backing up the current database first"
    cmd_backup
    log "Restoring"
    "${COMPOSE[@]}" stop backend
    "${COMPOSE[@]}" exec -T db psql -U diagnosticar -d diagnosticar -v ON_ERROR_STOP=1 -q \
        -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
    gunzip -c "$dump" | "${COMPOSE[@]}" exec -T db psql -U diagnosticar -d diagnosticar -v ON_ERROR_STOP=1 -q >/dev/null
    rm -f "$dump"
    "${COMPOSE[@]}" start backend
    log "Restored"
}

# --- secrets ---------------------------------------------------------------------
# Generated here, on the machine, and never anywhere else: not in Terraform's
# state, not in GitHub, not on the laptop.

hex() { openssl rand -hex "$1"; }
one_line() { awk 'BEGIN{ORS="\\n"} {print}' | sed 's/\\n$//'; }

generate_keypair() {
    local private
    private=$(openssl genrsa 2048 2>/dev/null)
    [ -n "$private" ] || die "openssl could not generate the key pair"
    kv_set "$SECRETS" JWT_ACCESS_PRIVATE_KEY "$(printf '%s\n' "$private" | one_line)"
    kv_set "$SECRETS" JWT_ACCESS_PUBLIC_KEY "$(printf '%s\n' "$private" | openssl rsa -pubout 2>/dev/null | one_line)"
    unset private
}

cmd_init_secrets() {
    mkdir -p "$ETC"
    [ -f "$SECRETS" ] || install -m 600 /dev/null "$SECRETS"
    local name
    # POSTGRES_PASSWORD is fixed in the database volume when it is created:
    # never regenerated.
    [ -n "$(kv_get "$SECRETS" POSTGRES_PASSWORD)" ] || { kv_set "$SECRETS" POSTGRES_PASSWORD "$(hex 24)"; echo "  generated POSTGRES_PASSWORD"; }
    for name in JWT_ACCESS_SECRET JWT_REFRESH_SECRET; do
        [ -n "$(kv_get "$SECRETS" "$name")" ] || { kv_set "$SECRETS" "$name" "$(hex 32)"; echo "  generated $name"; }
    done
    if [ -z "$(kv_get "$SECRETS" JWT_ACCESS_PRIVATE_KEY)" ] || [ -z "$(kv_get "$SECRETS" JWT_ACCESS_PUBLIC_KEY)" ]; then
        generate_keypair
        echo "  generated JWT_ACCESS_PRIVATE_KEY / JWT_ACCESS_PUBLIC_KEY"
    fi
}

cmd_set_secret() {
    local name="${1:-}" value
    case " $SETTABLE " in *" $name "*) ;; *) die "usage: diagnosticar set-secret <$SETTABLE>  (value on standard input)" ;; esac
    # From a file or a pipe, never from the command line. A value without a
    # final newline makes read return non-zero after reading it.
    IFS= read -r value || [ -n "${value:-}" ]
    [ -n "$value" ] || die "empty value on standard input"
    case "$name" in
        CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)
            [[ "$value" == sk-ant-* ]] || die "that does not look like a Claude token or Anthropic key (sk-ant-...)" ;;
    esac
    kv_set "$SECRETS" "$name" "$value"
    unset value
    echo "stored $name"
    case "$name" in
        REGISTRY_*) echo "Next: diagnosticar deploy" ;;
        BACKUP_*)   echo "Used by the next backup (diagnosticar backup to try it now)" ;;
        *)          render_env 2>/dev/null && "${COMPOSE[@]}" up -d hpo-recognizer >/dev/null 2>&1 \
                        && echo "the extractor restarted with it" || echo "Next: diagnosticar deploy --force" ;;
    esac
}

cmd_rotate() {
    case "${1:-}" in
        JWT_ACCESS_SECRET|JWT_REFRESH_SECRET) kv_set "$SECRETS" "$1" "$(hex 32)" ;;
        JWT_ACCESS_KEYPAIR|JWT_ACCESS_PRIVATE_KEY|JWT_ACCESS_PUBLIC_KEY) generate_keypair ;;
        POSTGRES_PASSWORD) die "POSTGRES_PASSWORD is fixed in the database volume; change it there with ALTER USER first" ;;
        *) die "usage: diagnosticar rotate JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|JWT_ACCESS_KEYPAIR" ;;
    esac
    echo "rotated $1; every session is signed out after: diagnosticar deploy --force"
}

cmd_secrets() { cut -d= -f1 "$SECRETS" 2>/dev/null | sort; }

# --- genes.db and the stack -------------------------------------------------------

cmd_install_genes() {
    local want tmp
    [ -s "$ROOT/genes.lock" ] || die "the stack is not installed yet: remote.sh install-stack first"
    want=$(sed -n 's/^GENES_DB_SHA256=//p' "$ROOT/genes.lock")
    mkdir -p "$ROOT/data"
    tmp=$(mktemp "$ROOT/data/genes.db.XXXXXX")
    cat > "$tmp"
    if ! echo "$want  $tmp" | sha256sum -c --quiet 2>/dev/null; then
        rm -f "$tmp"
        die "that genes.db is not the one pinned in genes.lock"
    fi
    chmod 644 "$tmp"
    mv "$tmp" "$ROOT/data/genes.db"
    log "genes.db installed ($(sed -n 's/^GENES_TAG=//p' "$ROOT/genes.lock"))"
    if [ -s "$IMAGES" ]; then "${COMPOSE[@]}" restart backend >/dev/null && log "backend restarted"; fi
}

# The stack arrives as a tar.gz of exactly these files (remote.sh builds it
# from infra/cloud/stack), is checked with `docker compose config`, and only
# then replaces the running one.
STACK_FILES="docker-compose.yml Caddyfile diagnosticar.sh genes.lock ops/seed-admin.sh"

cmd_install_stack() {
    local tmp f
    tmp=$(mktemp -d)
    tar -xzf - -C "$tmp"
    for f in $STACK_FILES; do
        [ -s "$tmp/$f" ] || { rm -rf "$tmp"; die "the stack is missing $f"; }
    done
    if [ -s "$IMAGES" ] && [ -s "$ROOT/.env" ]; then
        docker compose --project-directory "$tmp" -f "$tmp/docker-compose.yml" --env-file "$ROOT/.env" config -q \
            || { rm -rf "$tmp"; die "the new docker-compose.yml does not validate"; }
    fi
    mkdir -p "$ROOT/ops"
    for f in $STACK_FILES; do
        install -m 644 "$tmp/$f" "$ROOT/$f"
    done
    chmod 755 "$ROOT/ops/seed-admin.sh"
    install -m 755 "$tmp/diagnosticar.sh" /usr/local/bin/diagnosticar
    rm -rf "$tmp"
    log "Stack installed"
    # The new script runs the deploy, once there is something to deploy.
    [ -s "$ROOT/data/genes.db" ] || { echo "Not deploying yet: genes.db is missing (remote.sh install-genes)."; return 0; }
    exec /usr/local/bin/diagnosticar deploy --force
}

# ----------------------------------------------------------------------------------

[ "$(id -u)" = 0 ] || die "run as root: sudo diagnosticar $*"

case "${1:-}" in
    deploy)        shift; cmd_deploy "$@" ;;
    rollback)      cmd_rollback ;;
    status)        cmd_status ;;
    logs)          shift; cmd_logs "$@" ;;
    stats)         cmd_stats ;;
    seed-admin)    shift; cmd_seed_admin "$@" ;;
    backup)        cmd_backup ;;
    restore)       shift; cmd_restore "$@" ;;
    init-secrets)  cmd_init_secrets ;;
    set-secret)    shift; cmd_set_secret "$@" ;;
    rotate)        shift; cmd_rotate "$@" ;;
    secrets)       cmd_secrets ;;
    install-genes) cmd_install_genes ;;
    install-stack) cmd_install_stack ;;
    *)             sed -n '2,23p' "$0"; exit 1 ;;
esac
