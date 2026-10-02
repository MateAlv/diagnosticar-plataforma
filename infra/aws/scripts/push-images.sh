#!/usr/bin/env bash
# Builds the four images from source and pushes them to this deployment's ECR,
# then points the instance at them (/diagnosticar/config/IMAGE_TAG).
#
#   scripts/push-images.sh                     all four
#   scripts/push-images.sh frontend            only some (backend frontend hpo-recognizer model)
#   SKIP_TESTS=1 scripts/push-images.sh ...    skip the in-image test suites
#
# Then: scripts/remote.sh deploy
#
# From source rather than GHCR, so no GitHub packages token is needed, and from
# exactly the commits a release would use:
#   backend, frontend   HEAD of this checkout (git archive: committed code only)
#   hpo-recognizer      diagnostic.ar-api @ GATEWAY_COMMIT + spanish-symptoms-recognizer
#                       @ RECOGNIZER_COMMIT, both from .github/recognizer.env
#   model               diagnostic.ar-api @ GATEWAY_COMMIT, with the model release pinned
#                       in its services/genphenai/model.lock (fetched with `gh`); the
#                       extractor's HPO embeddings likewise, from embeddings.lock
# The two sibling repositories are only fetched and read with `git archive`:
# their working trees and branches are left as they are.
#
# The frontend is compiled for this deployment's domain (NEXT_PUBLIC_* are
# baked into the bundle), read from the Terraform outputs.
#
# Needs: docker (BuildKit), git, gh (logged in, for the model release), aws,
# terraform, and ~15 GB free for the build. The extractor takes ~30 min cold.
set -euo pipefail

PROFILE="${AWS_PROFILE:-diagnosticar}"
REGION="${AWS_REGION:-us-east-1}"
AWS=(aws --profile "$PROFILE" --region "$REGION")

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$INFRA/../.." && pwd)"          # diagnostic.ar
SIBLINGS="$(cd "$REPO/.." && pwd)"
API_REPO="${API_REPO:-$SIBLINGS/diagnostic.ar-api}"
RECOGNIZER_REPO="${RECOGNIZER_REPO:-$SIBLINGS/spanish-symptoms-recognizer}"

ALL=(backend frontend hpo-recognizer model)
IMAGES=("$@")
[ ${#IMAGES[@]} -gt 0 ] || IMAGES=("${ALL[@]}")

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
want() { local i; for i in "${IMAGES[@]}"; do [ "$i" = "$1" ] && return 0; done; return 1; }

for i in "${IMAGES[@]}"; do
    case " ${ALL[*]} " in *" $i "*) ;; *) die "unknown image '$i' (one of: ${ALL[*]})" ;; esac
done

# --- What to build ------------------------------------------------------------
tf_out() { terraform -chdir="$INFRA/main" output -raw "$1"; }
DOMAIN=$(tf_out domain) || die "no Terraform outputs: apply infra/aws/main first"
REGISTRY=$(tf_out ecr_registry)

# shellcheck source=/dev/null
. "$REPO/.github/recognizer.env"
[[ "$GATEWAY_COMMIT" =~ ^[0-9a-f]{40}$ ]] || die "GATEWAY_COMMIT is not a full SHA"
[[ "$RECOGNIZER_COMMIT" =~ ^[0-9a-f]{40}$ ]] || die "RECOGNIZER_COMMIT is not a full SHA"

if [ -n "$(git -C "$REPO" status --porcelain -- frontend backend)" ]; then
    die "frontend/ or backend/ has uncommitted changes; only committed code is built"
fi
APP_COMMIT=$(git -C "$REPO" log -1 --format=%H -- frontend backend)
# One tag for the set: the app commit and the API commit it runs against.
TAG="${APP_COMMIT:0:7}-${GATEWAY_COMMIT:0:7}"

echo "domain   https://$DOMAIN"
echo "registry $REGISTRY"
echo "tag      $TAG"
echo "images   ${IMAGES[*]}"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

extract() {  # extract REPO COMMIT DEST
    git -C "$1" cat-file -e "$2^{commit}" 2>/dev/null || git -C "$1" fetch --quiet origin
    git -C "$1" cat-file -e "$2^{commit}" 2>/dev/null || die "$2 is not in $1, even after fetching"
    mkdir -p "$3"
    git -C "$1" archive "$2" | tar -x -C "$3"
}

image() { echo "$REGISTRY/diagnosticar-$1:$TAG"; }

# Runs CMD in a throwaway container of IMAGE with SRC copied to DEST first.
# Copied rather than bind-mounted: Docker Desktop runs the daemon in a VM that
# cannot see this script's temporary directory.
run_with() {  # run_with IMAGE SRC DEST CMD [docker create options...]
    local img=$1 src=$2 dest=$3 cmd=$4 cid rc=0
    shift 4
    cid=$(docker create "$@" "$img" sh -c "$cmd")
    docker cp "$src" "$cid:$dest"
    docker start -a "$cid" || rc=$?
    docker rm -f "$cid" >/dev/null
    return "$rc"
}

BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# --- Builds -------------------------------------------------------------------
if want backend || want frontend; then
    extract "$REPO" "$APP_COMMIT" "$WORK/app"
fi

if want backend; then
    log "backend"
    docker build -t "$(image backend)" \
        --build-arg RELEASE_VERSION="$TAG" \
        --build-arg RELEASE_COMMIT="$APP_COMMIT" \
        --build-arg RELEASE_BUILT_AT="$BUILT_AT" \
        "$WORK/app/backend"
fi

if want frontend; then
    log "frontend, for https://$DOMAIN"
    docker build -t "$(image frontend)" \
        --build-arg NEXT_PUBLIC_API_URL="https://$DOMAIN/api" \
        --build-arg NEXT_PUBLIC_API_BASE_URL="https://$DOMAIN/api" \
        --build-arg NEXT_PUBLIC_HPO_API_URL="https://$DOMAIN/hpo-api" \
        --build-arg NEXT_PUBLIC_GENPHENAI_URL="https://$DOMAIN/genphenai" \
        "$WORK/app/frontend"
fi

if want hpo-recognizer || want model; then
    extract "$API_REPO" "$GATEWAY_COMMIT" "$WORK/api"
fi

if want model; then
    log "model (fetching the pinned release)"
    GITHUB_TOKEN=$(gh auth token) "$WORK/api/services/genphenai/fetch_model.sh"
    docker build -t "$(image model)" -f "$WORK/api/services/genphenai/Dockerfile" "$WORK/api"
    if [ -z "${SKIP_TESTS:-}" ]; then
        # The same check as the release: three clinical cases against the
        # rankings production served. A wrong model fails here.
        run_with "$(image model)" "$WORK/api/services/genphenai/tests" /app/tests \
            "pip install -q --user pytest==8.3.2 httpx==0.28.1 && python -m pytest /app/tests -q -p no:cacheprovider"
    fi
fi

if want hpo-recognizer; then
    log "hpo-recognizer (~30 min the first time)"
    extract "$RECOGNIZER_REPO" "$RECOGNIZER_COMMIT" "$WORK/recognizer"
    # The HPO embeddings come ready made from diagnostic.ar-model, when the
    # pinned API is one that reads them (services/api-gateway/embeddings.lock).
    if [ -f "$WORK/api/services/api-gateway/embeddings.lock" ]; then
        GITHUB_TOKEN=$(gh auth token) "$WORK/api/services/api-gateway/fetch_embeddings.sh"
    fi
    docker build -t "$(image hpo-recognizer)" \
        -f "$WORK/api/services/api-gateway/Dockerfile.recognizer" \
        --build-context recognizer="$WORK/recognizer" \
        "$WORK/api"
    if [ -z "${SKIP_TESTS:-}" ]; then
        docker run --rm -e PYTHONPATH=/app/services/api-gateway:/app:/opt/recognizer \
            -w /app/services/api-gateway "$(image hpo-recognizer)" \
            python -m pytest tests/ -q -p no:cacheprovider
        docker run --rm -w /opt/recognizer "$(image hpo-recognizer)" \
            python -m pytest symptoms_recognizer/tests/ -q -p no:cacheprovider
    fi
fi

# --- Push -----------------------------------------------------------------------
log "Pushing to ECR"
# The ECR token (valid 12 h) goes into a Docker config of our own, in RAM
# (/dev/shm), never into the user's: theirs may keep logins in a GPG-backed
# store whose passphrase prompt cannot appear without a terminal, and this way
# nothing is left behind there either. The directory is removed on exit, even
# on failure. DOCKER_HOST keeps pointing at the daemon of the current context,
# which a fresh config would not know about.
DOCKER_ENDPOINT=$(docker context inspect --format '{{.Endpoints.docker.Host}}')
PUSH_CONFIG=$(mktemp -d -p /dev/shm diagnosticar-docker.XXXXXX 2>/dev/null || mktemp -d)
chmod 700 "$PUSH_CONFIG"
echo '{}' > "$PUSH_CONFIG/config.json"
trap 'rm -rf "$WORK" "$PUSH_CONFIG"' EXIT
push_docker() { DOCKER_CONFIG="$PUSH_CONFIG" DOCKER_HOST="$DOCKER_ENDPOINT" docker "$@"; }

"${AWS[@]}" ecr get-login-password | push_docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
for i in "${IMAGES[@]}"; do
    push_docker push --quiet "$(image "$i")"
done
push_docker logout "$REGISTRY" >/dev/null 2>&1 || true
rm -rf "$PUSH_CONFIG"

# Move the instance to this tag only when every image exists under it;
# otherwise a deploy would pull a set that is half missing.
missing=()
for i in "${ALL[@]}"; do
    "${AWS[@]}" ecr describe-images --repository-name "diagnosticar-$i" \
        --image-ids imageTag="$TAG" >/dev/null 2>&1 || missing+=("$i")
done
if [ ${#missing[@]} -gt 0 ]; then
    log "Not switching IMAGE_TAG: ${missing[*]} has no image tagged $TAG yet."
    exit 0
fi

"${AWS[@]}" ssm put-parameter --name /diagnosticar/config/IMAGE_TAG --type String \
    --value "$TAG" --overwrite >/dev/null
# A hand-built set replaces whatever the workflows deployed: the per-image
# tags go away and every image falls back to IMAGE_TAG.
for p in BACKEND_TAG FRONTEND_TAG RECOGNIZER_TAG MODEL_TAG; do
    "${AWS[@]}" ssm delete-parameter --name "/diagnosticar/config/$p" >/dev/null 2>&1 || true
done
log "IMAGE_TAG=$TAG. Now: infra/aws/scripts/remote.sh deploy"
