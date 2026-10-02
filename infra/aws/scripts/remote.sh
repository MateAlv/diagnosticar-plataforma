#!/usr/bin/env bash
# Runs `diagnosticar <command>` on the instance through SSM Run Command, from
# a laptop, with no SSH and no open port 22.
#
#   scripts/remote.sh deploy
#   scripts/remote.sh status
#   scripts/remote.sh logs [service]
#   scripts/remote.sh stats
#   scripts/remote.sh seed-admin you@example.org
#   scripts/remote.sh backup
#
# Run Command keeps a command's output in the account for a while, so nothing
# the instance runs prints a secret. seed-admin only promotes an account that
# signed up on the web; no password ever passes through here.
set -euo pipefail

PROFILE="${AWS_PROFILE:-diagnosticar}"
REGION="${AWS_REGION:-us-east-1}"
AWS=(aws --profile "$PROFILE" --region "$REGION")
INFRA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ $# -gt 0 ] || { sed -n '2,15p' "$0"; exit 1; }
case "$1" in
    deploy|status|logs|stats|seed-admin|backup) ;;
    *) die "unknown command '$1'" ;;
esac

# Each argument is quoted for the remote shell, so an email or a service name
# cannot smuggle a second command in.
remote="/usr/local/bin/diagnosticar"
for arg in "$@"; do
    [[ "$arg" =~ ^[A-Za-z0-9@._+-]+$ ]] || die "unexpected characters in '$arg'"
    remote+=" $(printf '%q' "$arg")"
done

INSTANCE=$(terraform -chdir="$INFRA/main" output -raw instance_id) \
    || die "no Terraform outputs: apply infra/aws/main first"

params=$(python3 -c 'import json,sys; print(json.dumps({"commands": [sys.argv[1]], "executionTimeout": ["1800"]}))' "$remote")
id=$("${AWS[@]}" ssm send-command --instance-ids "$INSTANCE" \
        --document-name AWS-RunShellScript \
        --comment "diagnosticar $1" \
        --parameters "$params" \
        --query Command.CommandId --output text)

echo "==> $remote  (command $id)"
while :; do
    status=$("${AWS[@]}" ssm get-command-invocation --command-id "$id" --instance-id "$INSTANCE" \
                --query Status --output text 2>/dev/null || echo Pending)
    case "$status" in
        Pending|InProgress|Delayed) sleep 3 ;;
        *) break ;;
    esac
done

"${AWS[@]}" ssm get-command-invocation --command-id "$id" --instance-id "$INSTANCE" \
    --query StandardOutputContent --output text
err=$("${AWS[@]}" ssm get-command-invocation --command-id "$id" --instance-id "$INSTANCE" \
    --query StandardErrorContent --output text)
[ -z "$err" ] || [ "$err" = "None" ] || printf '%s\n' "$err" >&2

[ "$status" = "Success" ] || die "remote command ended $status"
