#!/usr/bin/env bash
set -euo pipefail

RENDERED="${1:?usage: build.sh <stage the fleet build command rendered>}"
STAGE="$RENDERED/home"
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

TAR="${TMPDIR:-/tmp}/my-omp.tar"
docker buildx build --provenance=false --sbom=false \
	--build-context omp-home="$STAGE" \
	--output "type=docker,dest=$TAR" -t my-omp:v1 "$RENDERED/context"
sbx template rm my-omp:v1 --force 2>/dev/null </dev/null || sbx template rm my-omp:v1 2>/dev/null </dev/null || true
sbx template load "$TAR"
rm -f "$TAR"
