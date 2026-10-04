#!/usr/bin/env bash
# Administers a diagnostic.ar machine from a laptop, the same on every
# provider: `diagnosticar <command>` over SSH, as the `diagnosticar` user.
#
#   scripts/remote.sh open                 open port 22 for this laptop's address (asks first)
#   scripts/remote.sh close                close it again
#   scripts/remote.sh setup                first time: stack, genes.db, registry token
#   scripts/remote.sh install-stack        push infra/cloud/stack to the machine and deploy it
#   scripts/remote.sh install-genes        download the release pinned in genes.lock, check it, install it
#   scripts/remote.sh set-secret NAME [< file]   REGISTRY_USERNAME, REGISTRY_TOKEN,
#                                                CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY,
#                                                BACKUP_REMOTE_SECRET
#   scripts/remote.sh restore FILE.sql.gz  replace the database with a local dump (asks first)
#   scripts/remote.sh ssh                  a shell on the machine
#   scripts/remote.sh deploy|rollback|status|logs [svc]|stats|backup|secrets|seed-admin EMAIL|rotate NAME
#
# Which machine:
#   CLOUD_PROVIDER  the adapter under providers/ (default: aws); its Terraform
#                   outputs give the address, and `open`/`close` apply it
#   CLOUD_HOST      an address instead, for a machine made by hand (providers/manual)
#   CLOUD_SSH_KEY   the private key (default: ~/.ssh/diagnosticar_cloud)
#
# Port 22 is closed by default and opened only for the address you are at, for
# as long as you need it: `open`, work, `close`. Any later `terraform apply`
# closes it too, since the address is never saved.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLOUD="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$CLOUD/../.." && pwd)"
PROVIDER="${CLOUD_PROVIDER:-aws}"
TF_DIR="$CLOUD/providers/$PROVIDER"
KEY="${CLOUD_SSH_KEY:-$HOME/.ssh/diagnosticar_cloud}"

log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

host() {
    if [ -n "${CLOUD_HOST:-}" ]; then echo "$CLOUD_HOST"; return; fi
    [ -d "$TF_DIR" ] || die "no adapter providers/$PROVIDER; set CLOUD_PROVIDER or CLOUD_HOST"
    terraform -chdir="$TF_DIR" output -raw ssh_host 2>/dev/null \
        || die "no Terraform outputs in providers/$PROVIDER: apply it first, or set CLOUD_HOST"
}

ssh_opts() {
    [ -f "$KEY" ] || die "no private key at $KEY (CLOUD_SSH_KEY)"
    # A known_hosts of our own: a replaced machine has a new host key on the
    # same address, and its old entry should not sit in the user's file.
    printf '%s\n' -i "$KEY" -o IdentitiesOnly=yes -o ConnectTimeout=10 \
        -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$HOME/.ssh/known_hosts_diagnosticar"
}

on_machine() {  # on_machine ARGS... — runs `sudo diagnosticar ARGS` there, stdin passed through
    local opts remote arg
    mapfile -t opts < <(ssh_opts)
    # Each argument is checked and quoted for the remote shell, so an email or
    # a service name cannot smuggle a second command in.
    remote="sudo /usr/local/bin/diagnosticar"
    for arg in "$@"; do
        [[ "$arg" =~ ^[A-Za-z0-9@._+-]+$ ]] || die "unexpected characters in '$arg'"
        remote+=" $(printf '%q' "$arg")"
    done
    # shellcheck disable=SC2029  # built and quoted here on purpose
    ssh "${opts[@]}" "diagnosticar@$(host)" "$remote" \
        || die "the command failed on the machine (is port 22 open? remote.sh open)"
}

# --- port 22 ----------------------------------------------------------------------

my_ip() {
    local url ip
    for url in https://checkip.amazonaws.com https://api.ipify.org https://ifconfig.me/ip; do
        ip=$(curl -4 -fsS --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]') || continue
        [[ "$ip" =~ ^[0-9]+(\.[0-9]+){3}$ ]] && { echo "$ip"; return 0; }
    done
    die "could not find this laptop's public address"
}

set_admin_cidrs() {  # set_admin_cidrs '["1.2.3.4/32"]' | '[]'
    [ -z "${CLOUD_HOST:-}" ] || die "CLOUD_HOST is a machine made by hand: open or close port 22 in its provider's console"
    [ "$PROVIDER" != manual ] || die "providers/manual creates no machine: use its provider's console"
    # Interactive on purpose: the plan shows exactly what changes, and nothing
    # is applied until you type yes.
    terraform -chdir="$TF_DIR" apply -var "admin_cidrs=$1"
}

cmd_open() {
    local ip
    ip=$(my_ip)
    log "Opening port 22 for $ip/32 only"
    set_admin_cidrs "[\"$ip/32\"]"
    echo "Close it when you are done: scripts/remote.sh close"
}

cmd_close() {
    log "Closing port 22"
    set_admin_cidrs '[]'
}

# --- the stack, genes.db, secrets -------------------------------------------------

cmd_install_stack() {
    local tmp
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' RETURN
    mkdir -p "$tmp/ops"
    cp "$CLOUD/stack/docker-compose.yml" "$CLOUD/stack/Caddyfile" "$CLOUD/stack/diagnosticar.sh" \
       "$CLOUD/stack/genes.lock" "$tmp/"
    cp "$REPO/ops/seed-admin.sh" "$tmp/ops/"
    log "Installing the stack from $(git -C "$REPO" rev-parse --short HEAD)$(git -C "$REPO" diff --quiet -- infra/cloud/stack || echo ' (with local changes)')"
    tar -czf - -C "$tmp" . | on_machine install-stack
}

cmd_install_genes() {
    local tmp
    # shellcheck source=/dev/null
    . "$CLOUD/stack/genes.lock"
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' RETURN
    log "Downloading $GENES_TAG from $GENES_REPO"
    gh release download "$GENES_TAG" -R "$GENES_REPO" --pattern "$GENES_ASSET" --dir "$tmp"
    echo "$GENES_ASSET_SHA256  $tmp/$GENES_ASSET" | sha256sum -c --quiet \
        || die "$GENES_ASSET does not match genes.lock: not installing it"
    tar -xzf "$tmp/$GENES_ASSET" -C "$tmp" genes.db
    on_machine install-genes < "$tmp/genes.db"
}

cmd_set_secret() {
    local name="${1:-}" value
    [ -n "$name" ] || die "usage: remote.sh set-secret NAME [< file]"
    if [ -t 0 ]; then
        # Typed or pasted, never shown, never in the shell history.
        read -r -s -p "$name (not shown): " value; echo
        printf '%s\n' "$value" | on_machine set-secret "$name"
        unset value
    else
        on_machine set-secret "$name"
    fi
}

cmd_setup() {
    log "1/3 The stack"
    cmd_install_stack
    log "2/3 genes.db"
    cmd_install_genes
    log "3/3 The registry token (a GitHub token with read:packages)"
    on_machine secrets | grep -qx REGISTRY_USERNAME || cmd_set_secret REGISTRY_USERNAME
    on_machine secrets | grep -qx REGISTRY_TOKEN || cmd_set_secret REGISTRY_TOKEN
    on_machine deploy --force
    echo
    echo "Next, if this machine should extract symptoms from text:"
    echo "  scripts/remote.sh set-secret CLAUDE_CODE_OAUTH_TOKEN < file-with-the-token"
}

cmd_restore() {
    local file="${1:-}" answer
    [ -f "$file" ] || die "usage: remote.sh restore FILE.sql.gz  (a dump made by diagnosticar backup)"
    gzip -t "$file" || die "$file is not a gzip'd dump"
    read -r -p "This replaces the whole database on $(host) with $file. Type the address to confirm: " answer
    [ "$answer" = "$(host)" ] || die "not confirmed"
    on_machine restore --yes - < "$file"
}

cmd_ssh() {
    local opts
    mapfile -t opts < <(ssh_opts)
    exec ssh "${opts[@]}" "diagnosticar@$(host)"
}

# ----------------------------------------------------------------------------------

[ $# -gt 0 ] || { sed -n '2,25p' "$0"; exit 1; }
cmd="$1"; shift
case "$cmd" in
    open)          cmd_open ;;
    close)         cmd_close ;;
    setup)         cmd_setup ;;
    install-stack) cmd_install_stack ;;
    install-genes) cmd_install_genes ;;
    set-secret)    cmd_set_secret "$@" ;;
    restore)       cmd_restore "$@" ;;
    ssh)           cmd_ssh ;;
    deploy|rollback|status|logs|stats|backup|secrets|seed-admin|rotate)
                   on_machine "$cmd" "$@" ;;
    *)             die "unknown command '$cmd' (run without arguments for the list)" ;;
esac
