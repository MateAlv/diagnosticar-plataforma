#!/usr/bin/env bash
# Generates the deployment's secrets and stores them in SSM Parameter Store as
# SecureString under /diagnosticar/secrets/. They never touch the repository or
# the Terraform state, and are never printed.
#
#   scripts/make-secrets.sh                 create whatever is missing
#   scripts/make-secrets.sh --rotate NAME   replace one (see below)
#   scripts/make-secrets.sh --set-claude-token    the subscription token, not echoed
#                                                   (or: ... --set-claude-token < file)
#   scripts/make-secrets.sh --set-anthropic-key   paste the key, not echoed
#   scripts/make-secrets.sh --list          which exist (names only)
#
# Everything is generated new for this deployment, as docs/CLOUD_DEPLOY.md
# asks: nothing is copied from staging or production.
#
# Existing values are never overwritten unless asked, because some cannot be
# changed casually:
#   POSTGRES_PASSWORD  is fixed when the database volume is first created;
#                      changing it here alone locks the backend out. Not
#                      rotatable by this script.
#   JWT_*              rotating signs every session out. Harmless, but loud.
#
# Then on the instance: scripts/remote.sh deploy.
set -euo pipefail

PROFILE="${AWS_PROFILE:-diagnosticar}"
REGION="${AWS_REGION:-us-east-1}"
PREFIX=/diagnosticar/secrets
AWS=(aws --profile "$PROFILE" --region "$REGION")

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

exists() {
    "${AWS[@]}" ssm get-parameter --name "$PREFIX/$1" --query Parameter.Name --output text >/dev/null 2>&1
}

# The value reaches the CLI on its standard input (file:///dev/stdin): never on
# a command line, where `ps` could show it, and never in a file on disk.
put() {  # put NAME VALUE [--overwrite]
    printf '%s' "$2" | "${AWS[@]}" ssm put-parameter --name "$PREFIX/$1" --type SecureString \
        --value file:///dev/stdin ${3:+"$3"} >/dev/null
    echo "  stored $1"
}

hex() { openssl rand -hex "$1"; }

# A PEM on one line with literal \n, which is how the backend
# (JWT_ACCESS_*_KEY) and the extractor (JWT_PUBLIC_KEY) both read it.
one_line() { awk 'BEGIN{ORS="\\n"} {print}' | sed 's/\\n$//'; }

generate() {  # generate NAME [--overwrite]
    case "$1" in
        JWT_ACCESS_SECRET|JWT_REFRESH_SECRET)
            put "$1" "$(hex 32)" ${2:+"$2"} ;;
        POSTGRES_PASSWORD)
            # Hex: safe inside DATABASE_URL without escaping.
            put "$1" "$(hex 24)" ${2:+"$2"} ;;
        JWT_ACCESS_KEYPAIR)
            # Generated in memory; the private key never touches the disk.
            local private
            private=$(openssl genrsa 2048 2>/dev/null)
            [ -n "$private" ] || die "openssl could not generate the key pair"
            put JWT_ACCESS_PRIVATE_KEY "$(printf '%s\n' "$private" | one_line)" ${2:+"$2"}
            put JWT_ACCESS_PUBLIC_KEY "$(printf '%s\n' "$private" | openssl rsa -pubout 2>/dev/null | one_line)" ${2:+"$2"}
            unset private ;;
        ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)
            # SSM cannot store an empty string; the instance turns this back
            # into empty, and the extractor reports itself not ready.
            put "$1" PLACEHOLDER ${2:+"$2"} ;;
        *) die "unknown secret: $1" ;;
    esac
}

create_missing() {
    local name
    for name in POSTGRES_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN; do
        if exists "$name"; then echo "  exists $name"; else generate "$name"; fi
    done
    # The two halves are generated together or not at all: one without the
    # other and the backend refuses to boot.
    if exists JWT_ACCESS_PRIVATE_KEY && exists JWT_ACCESS_PUBLIC_KEY; then
        echo "  exists JWT_ACCESS_PRIVATE_KEY / JWT_ACCESS_PUBLIC_KEY"
    else
        generate JWT_ACCESS_KEYPAIR --overwrite
    fi
}

case "${1:-}" in
    "")
        echo "==> Secrets in $PREFIX (profile $PROFILE)"
        create_missing ;;
    --rotate)
        name="${2:-}"
        case "$name" in
            JWT_ACCESS_SECRET|JWT_REFRESH_SECRET) generate "$name" --overwrite ;;
            JWT_ACCESS_PRIVATE_KEY|JWT_ACCESS_PUBLIC_KEY|JWT_ACCESS_KEYPAIR)
                generate JWT_ACCESS_KEYPAIR --overwrite ;;
            POSTGRES_PASSWORD)
                die "POSTGRES_PASSWORD is fixed in the existing database volume; change it there with ALTER USER first." ;;
            *) die "usage: --rotate JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|JWT_ACCESS_KEYPAIR" ;;
        esac
        echo "Every session will be signed out after scripts/remote.sh deploy." ;;
    --set-claude-token)
        # From `claude setup-token`, on the account whose subscription pays.
        # Read from standard input without echo, so it can come from a file
        # by redirection and never reach the screen, the history or `ps`.
        if [ -t 0 ]; then
            read -r -s -p "Claude subscription token (not shown): " token; echo
        else
            read -r token
        fi
        [[ "$token" == sk-ant-* ]] || die "that does not look like a Claude token (sk-ant-...)"
        put CLAUDE_CODE_OAUTH_TOKEN "$token" --overwrite
        unset token
        echo "Now: scripts/remote.sh deploy" ;;
    --set-anthropic-key)
        read -r -s -p "Anthropic API key (not shown): " key; echo
        [[ "$key" == sk-ant-* ]] || die "that does not look like an Anthropic API key (sk-ant-...)"
        put ANTHROPIC_API_KEY "$key" --overwrite
        unset key
        echo "Now: scripts/remote.sh deploy" ;;
    --list)
        "${AWS[@]}" ssm get-parameters-by-path --path "$PREFIX" \
            --query 'Parameters[].[Name,LastModifiedDate]' --output table ;;
    *)
        sed -n '2,25p' "$0"; exit 1 ;;
esac
