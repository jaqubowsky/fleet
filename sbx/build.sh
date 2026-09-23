#!/usr/bin/env bash
set -euo pipefail

usage="usage: build.sh <harness> <image> <stage the fleet build command rendered>"
NAME="${1:?$usage}"
IMAGE="${2:?$usage}"
RENDERED="${3:?$usage}"
STAGE="$RENDERED/home"
BUILD_ARGS=(--build-arg "UPDATE_BUST=$(date +%Y%m%d)-$("$NAME" --version 2>/dev/null | tr -cd '0-9.' || true)")
trap 'rm -rf "$RENDERED"' EXIT

cp -L "$HOME/.gitconfig" "$HOME/.gitconfig-work" "$HOME/.gitconfig-alice" "$STAGE/"
cp -L "$HOME/.config/git/allowed_signers" "$STAGE/"
find "$STAGE" -name .DS_Store -delete

git config --file "$STAGE/.gitconfig" commit.gpgsign false
git config --file "$STAGE/.gitconfig-work" --unset user.signingkey || true
git config --file "$STAGE/.gitconfig-alice" --unset user.signingkey || true

sed -i '' '/^\[url /,$d' "$STAGE/.gitconfig-work" "$STAGE/.gitconfig-alice"
cat >>"$STAGE/.gitconfig-work" <<'EOF'
[url "https://github.com/bob/"]
	insteadOf = git@github.com:bob/
	insteadOf = git@github.com-work:bob/
[url "https://github.com/globex/"]
	insteadOf = git@github.com:globex/
	insteadOf = git@github.com-work:globex/
EOF
cat >>"$STAGE/.gitconfig-alice" <<'EOF'
[url "https://github.com/alice/"]
	insteadOf = git@github.com:alice/
	insteadOf = git@github.com-personal:alice/
[url "https://github.com/acme/"]
	insteadOf = git@github.com:acme/
	insteadOf = git@github.com-personal:acme/
EOF

if [ -f "$RENDERED/stage.sh" ]; then . "$RENDERED/stage.sh"; fi

TAR="${TMPDIR:-/tmp}/${IMAGE%%:*}.tar"
docker buildx build --provenance=false --sbom=false \
	${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"} \
	--build-context "$NAME-home=$STAGE" \
	--output "type=docker,dest=$TAR" -t "$IMAGE" "$RENDERED/context"
sbx template rm "$IMAGE" --force 2>/dev/null </dev/null || sbx template rm "$IMAGE" 2>/dev/null </dev/null || true
sbx template load "$TAR"
rm -f "$TAR"
