#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

ROOT="$HOME/.pi"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/pi-sbx-stage.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/agent" "$STAGE/hooks" "$STAGE/skills"
for skill in analyze-task implement tdd two-axis-review to-testing diagnosing-bugs resolving-merge-conflicts unslop writing-for-agents how; do
  cp -RL "$ROOT/skills/$skill" "$STAGE/skills/"
done
mkdir -p "$STAGE/agent/extensions" && cp -L "$ROOT/agent/extensions/guard.ts" "$ROOT/agent/extensions/statusline.ts" "$STAGE/agent/extensions/"
cp -L "$ROOT/agent/models.json" "$STAGE/agent/"
cp -L "$ROOT/host/hooks/guard.sh" "$STAGE/hooks/"
cp -L "$ROOT/sbx/AGENTS.md" "$STAGE/agent/AGENTS.md"
cp -L "$HOME/.gitconfig" "$HOME/.gitconfig-work" "$HOME/.gitconfig-alice" "$STAGE/"
cp -L "$HOME/.config/git/allowed_signers" "$STAGE/"
find "$STAGE" -name .DS_Store -delete

git config --file "$STAGE/.gitconfig" commit.gpgsign false
git config --file "$STAGE/.gitconfig-work" --unset user.signingkey || true
git config --file "$STAGE/.gitconfig-alice" --unset user.signingkey || true

sed -i '' '/^\[url /,$d' "$STAGE/.gitconfig-work" "$STAGE/.gitconfig-alice"
cat >> "$STAGE/.gitconfig-work" <<'EOF'
[url "https://github.com/bob/"]
	insteadOf = git@github.com:bob/
	insteadOf = git@github.com-work:bob/
[url "https://github.com/globex/"]
	insteadOf = git@github.com:globex/
	insteadOf = git@github.com-work:globex/
EOF
cat >> "$STAGE/.gitconfig-alice" <<'EOF'
[url "https://github.com/alice/"]
	insteadOf = git@github.com:alice/
	insteadOf = git@github.com-personal:alice/
[url "https://github.com/acme/"]
	insteadOf = git@github.com:acme/
	insteadOf = git@github.com-personal:acme/
EOF

TAR="${TMPDIR:-/tmp}/my-pi.tar"
docker buildx build --provenance=false --sbom=false \
  --build-context pi-home="$STAGE" \
  --output "type=docker,dest=$TAR" -t my-pi:v1 .
sbx template rm my-pi:v1 2>/dev/null || true
sbx template load "$TAR"
rm -f "$TAR"
