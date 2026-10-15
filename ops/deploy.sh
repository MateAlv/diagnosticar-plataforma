#!/usr/bin/env bash
# Pull-based continuous deployment for nodo0.
#
# Nothing reaches into the node: no runner, no inbound access, no GitHub
# credential beyond the read-only ones it already has. cron runs this every five
# minutes; it asks GitHub for the newest release tag and deploys it once
# release.yml has published every image the environment runs, which only
# happens after CI and every image scan passed. A failed smoke test goes back
# to the release that was running before.
#
#   ops/deploy.sh staging              # what cron runs: deploy a new release, if there is one
#   ops/deploy.sh staging v0.10.0      # deploy this release now (also to go back to an older one)
#   ops/deploy.sh staging --rollback   # back to the release before the current one
#   ops/deploy.sh staging --status     # what runs, what is newest, and the end of the log
#
# Only staging for now. Production joins once it runs from GHCR images too
# (CI_CD.md, "Production").
#
# Each release is attempted once. A tag that failed is not retried; fix forward
# with the next tag. Deploying a tag by hand moves nothing back: cron only acts
# on a tag newer than every tag it has already handled.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GHCR="ghcr.io/${GHCR_OWNER:-matealv}"

# Free space a deploy needs, in GiB. Images land in Docker's root dir (/data on
# nodo0) and the checkout under /home; both disks are shared with other teams,
# so a deploy that would fill one does not start.
MIN_FREE_DOCKER_GIB=20
MIN_FREE_HOME_GIB=5

log() { echo "[$(date -Is)] $*"; }
die() { log "ERROR: $*"; exit 1; }

usage() {
  echo "usage: ops/deploy.sh staging [vX.Y.Z | --rollback | --status]" >&2
  exit 2
}

newest_tag() {
  git -C "$REPO_ROOT" ls-remote --tags --refs origin 'v*' \
    | sed 's|.*refs/tags/||' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V | tail -1
}

# True when $1 sorts after $2 as a version.
newer() {
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$1" ]
}

# release.yml pushes each image only after CI and that image's scan passed, so
# a tag that every image carries is a release that passed everything.
published() {
  local image
  for image in "${IMAGES[@]}"; do
    docker manifest inspect "$GHCR/$image:$1" >/dev/null 2>&1 || return 1
  done
}

free_gib() {
  df -Pk "$1" | awk 'NR == 2 { print int($4 / 1048576) }'
}

enough_disk() {
  local docker_root docker_free home_free
  docker_root="$(docker info -f '{{.DockerRootDir}}')"
  docker_free="$(free_gib "$docker_root")"
  home_free="$(free_gib "$REPO_ROOT")"
  if [ "$docker_free" -lt "$MIN_FREE_DOCKER_GIB" ] || [ "$home_free" -lt "$MIN_FREE_HOME_GIB" ]; then
    log "Not deploying: ${docker_free} GiB free in $docker_root (needs $MIN_FREE_DOCKER_GIB)," \
        "${home_free} GiB free under $REPO_ROOT (needs $MIN_FREE_HOME_GIB)."
    return 1
  fi
}

read_state() { cat "$STATE_DIR/$1" 2>/dev/null || true; }
write_state() { printf '%s\n' "$2" > "$STATE_DIR/$1"; }

# Check out the release's own compose files and scripts, then run them.
# COMPOSE_PROFILES only matters for a commit from before the question agent
# ran by default, which a rollback can land on.
run_release() {
  local tag=$1 ref=$2
  git -C "$REPO_ROOT" fetch -q --tags origin &&
    git -C "$REPO_ROOT" checkout -q --detach "$ref" &&
    COMPOSE_PROFILES=question-agent "$REPO_ROOT/ops/$ENVIRONMENT.sh" up "$tag" &&
    "$REPO_ROOT/ops/$ENVIRONMENT.sh" smoke
}

deploy() {
  local tag=$1 ref=$2 current current_ref
  current="$(read_state current)"
  current_ref="$(read_state current-ref)"
  [ -n "$current_ref" ] || current_ref="$(git -C "$REPO_ROOT" rev-parse HEAD)"

  enough_disk || return 1
  log "Deploying $tag to $ENVIRONMENT (running: ${current:-unknown})"
  if run_release "$tag" "$ref"; then
    if [ -n "$current" ] && [ "$current" != "$tag" ]; then
      write_state previous "$current"
      write_state previous-ref "$current_ref"
    fi
    write_state current "$tag"
    write_state current-ref "$(git -C "$REPO_ROOT" rev-parse HEAD)"
    log "$tag is live on $ENVIRONMENT"
    return 0
  fi

  log "$tag FAILED on $ENVIRONMENT"
  [ -n "$current" ] || die "nothing known to go back to; $ENVIRONMENT needs a hand"
  log "Going back to $current"
  if run_release "$current" "$current_ref"; then
    log "Back on $current. $tag was not deployed."
  else
    log "ROLLBACK FAILED: $ENVIRONMENT is not healthy and needs a hand"
  fi
  return 1
}

status() {
  local newest
  newest="$(newest_tag || true)"
  echo "environment: $ENVIRONMENT"
  echo "running:     $(read_state current) ($(read_state current-ref | cut -c1-12))"
  echo "previous:    $(read_state previous)"
  echo "handled:     $(read_state handled)"
  if [ -n "$newest" ] && published "$newest"; then
    echo "newest tag:  $newest (published)"
  else
    echo "newest tag:  ${newest:-unknown} (not published yet)"
  fi
  echo
  tail -n 20 "$STATE_DIR/deploy.log" 2>/dev/null || echo "(no deploy log yet)"
}

# What cron runs. Quiet unless there is something to do.
follow() {
  local handled newest
  handled="$(read_state handled)"
  newest="$(newest_tag)" || die "could not list the tags on GitHub"
  [ -n "$newest" ] || die "no release tags on GitHub"

  if [ -z "$handled" ]; then
    write_state handled "$newest"
    log "Following $ENVIRONMENT from $newest: the next newer tag deploys."
    return 0
  fi
  newer "$newest" "$handled" || return 0
  published "$newest" || return 0   # release.yml is still running
  enough_disk || return 1           # retried on the next run

  write_state handled "$newest"
  deploy "$newest" "refs/tags/$newest"
}

main() {
  ENVIRONMENT="${1:-}"
  case "$ENVIRONMENT" in
    staging)
      IMAGES=(diagnosticar-backend diagnosticar-frontend-staging diagnosticar-hpo-recognizer
              diagnosticar-model diagnosticar-question-agent)
      ;;
    *) usage ;;
  esac

  STATE_DIR="${DEPLOY_STATE_DIR:-$HOME/.local/state/diagnosticar/$ENVIRONMENT}"
  mkdir -p "$STATE_DIR"

  if [ "${2:-}" = --status ]; then
    status
    return 0
  fi

  # One deploy at a time: cron fires every five minutes and a first pull takes longer.
  exec 9>"$STATE_DIR/lock"
  if ! flock -n 9; then
    [ -z "${2:-}" ] || die "another deploy is running"
    return 0
  fi

  local log_file="$STATE_DIR/deploy.log"
  if [ -f "$log_file" ] && [ "$(stat -c %s "$log_file")" -gt 5000000 ]; then
    mv "$log_file" "$log_file.1"
  fi
  exec > >(tee -a "$log_file") 2>&1

  case "${2:-}" in
    "") follow ;;
    --rollback)
      local previous
      previous="$(read_state previous)"
      [ -n "$previous" ] || die "no previous release recorded"
      deploy "$previous" "$(read_state previous-ref)"
      ;;
    v*)
      [[ "$2" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "not a release tag: $2"
      published "$2" || die "$2 is not fully published on GHCR"
      if newer "$2" "$(read_state handled)"; then write_state handled "$2"; fi
      deploy "$2" "refs/tags/$2"
      ;;
    *) usage ;;
  esac
}

# A deploy checks out another commit, replacing this file while it runs.
# Everything is inside main, read whole before it starts, so bash never
# executes a mix of the two versions.
main "$@"; exit
