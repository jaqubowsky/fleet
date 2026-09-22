#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat >&2 <<'USAGE'
usage: deploy.sh [--apply]

Moves this repository to $HARNESS_HOME (default ~/harness), installs its
dependencies, parks the old per-harness repositories' sources in a backup
directory, renders ~/.pi, ~/.omp and ~/.claude from the shared sources, and
links fleet, ofleet, cfleet and the Claude hooks. Without --apply it prints
every step and changes nothing. Runtime state (sessions, logins, caches) stays.
USAGE
	exit 2
}

apply=0
case "${1:-}" in
	--apply) apply=1 ;;
	"") ;;
	*) usage ;;
esac

SOURCE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
TARGET="${HARNESS_HOME:-$HOME/harness}"
BACKUP="$HOME/harness-migration-$(date +%Y%m%d-%H%M%S)"

run() {
	printf '  %s\n' "$*"
	if [ "$apply" = 1 ]; then "$@"; fi
}

park() {
	local path="$1" rel
	[ -e "$path" ] || [ -L "$path" ] || return 0
	rel="${path#"$HOME"/}"
	run mkdir -p "$BACKUP/$(dirname "$rel")"
	run mv "$path" "$BACKUP/$rel"
}

link() {
	run mkdir -p "$(dirname "$2")"
	run ln -sfn "$1" "$2"
}

park_repo() {
	local home="$1" entry
	[ -d "$home/.git" ] || return 0
	echo "== park the old repository in $home"
	while IFS= read -r entry; do
		case "$entry" in
			agent/*) park "$home/$entry" ;;
			*) park "$home/${entry%%/*}" ;;
		esac
	done < <(git -C "$home" ls-files | awk -F/ '$1 == "agent" { print; next } { print $1 }' | sort -u)
	park "$home/.git"
}

render() {
	echo "== render $1 into ~/.$1"
	run env FLEET_HARNESS="$1" node "$TARGET/src/fleet/cli.ts" render
}

echo "== repository: $SOURCE -> $TARGET"
if [ "$SOURCE" != "$TARGET" ]; then
	[ ! -e "$TARGET" ] || { echo "deploy: $TARGET already exists; move it away or set HARNESS_HOME" >&2; exit 1; }
	[ ! -L "$SOURCE/node_modules" ] || run rm "$SOURCE/node_modules"
	run mv "$SOURCE" "$TARGET"
fi
run npm ci --prefix "$TARGET"

echo "== claude hooks, herdr config and statusline first, so no guard is ever missing"
if [ "$apply" = 1 ]; then
	python3 "$TARGET/claude/tools/align-settings.py" --apply
else
	echo "  python3 $TARGET/claude/tools/align-settings.py --apply"
fi
link "$TARGET/claude/statusline.mjs" "$HOME/.claude/statusline.mjs"

park_repo "$HOME/.pi"
park_repo "$HOME/.omp"
park_repo "$HOME/.claude"
park "$HOME/.pi/skills"
park "$HOME/.omp/skills"
park "$HOME/.claude/skills"
park "$HOME/.claude/rules"
park "$HOME/.claude/agents"

render pi
render omp
render claude

echo "== commands"
link "$TARGET/bin/fleet" "$HOME/.local/bin/fleet"
link "$TARGET/bin/ofleet" "$HOME/.local/bin/ofleet"
link "$TARGET/bin/cfleet" "$HOME/.local/bin/cfleet"

cat <<EOF

Left for the person:
- ~/.zshrc sources ~/.claude/host/fleet.zsh; cfleet replaces the sbx* functions, so remove that line
- the parked sources and the three old .git directories are in $BACKUP; delete it once the fleet works
- rebuild the images: fleet build, ofleet build, cfleet build
- checks: cd $TARGET && npm test && npm run check
EOF
[ "$apply" = 1 ] || echo "Dry run. Re-run with --apply to change anything."
