#!/usr/bin/env bash
# Gives a release's tags to an image already built from the same pinned
# commits, instead of building it again. Writes reused=true or false to
# $GITHUB_OUTPUT; the job's build steps run only on false.
#
#   SOURCE  the image tagged by its commits (ghcr.io/…/diagnosticar-model:api-<commit>)
#   TAGS    the release's tags, one per line (docker/metadata-action's `tags`)
set -euo pipefail

if ! docker buildx imagetools inspect "$SOURCE" >/dev/null 2>&1; then
  echo "Not built from these commits yet: building $SOURCE."
  echo "reused=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

args=()
while IFS= read -r tag; do
  [ -n "$tag" ] && args+=(--tag "$tag")
done <<< "$TAGS"
docker buildx imagetools create "${args[@]}" "$SOURCE"

echo "reused=true" >> "$GITHUB_OUTPUT"
echo "Reused \`$SOURCE\`, already built, tested and scanned from these commits." >> "$GITHUB_STEP_SUMMARY"
