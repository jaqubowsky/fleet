#!/usr/bin/env bash
set -euo pipefail

usage="usage: build.sh <harness> <image> <stage the fleet build command rendered>"
NAME="${1:?$usage}"
IMAGE="${2:?$usage}"
RENDERED="${3:?$usage}"
STAGE="$RENDERED/home"
BUILD_ARGS=(--build-arg "UPDATE_BUST=$(date +%Y%m%d)-$("$NAME" --version 2>/dev/null | tr -cd '0-9.' || true)")
trap 'rm -rf "$RENDERED"' EXIT

cp -RL "$HOME/.config/harness/git" "$STAGE/git"
find "$STAGE" -name .DS_Store -delete

if [ -f "$RENDERED/stage.sh" ]; then . "$RENDERED/stage.sh"; fi

TAR="${TMPDIR:-/tmp}/${IMAGE%%:*}.tar"
docker buildx build --provenance=false --sbom=false \
	${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} \
	--build-context "$NAME-home=$STAGE" \
	--output "type=docker,dest=$TAR" -t "$IMAGE" "$RENDERED/context"
sbx template rm "$IMAGE" --force 2>/dev/null </dev/null || sbx template rm "$IMAGE" 2>/dev/null </dev/null || true
sbx template load "$TAR"
rm -f "$TAR"
