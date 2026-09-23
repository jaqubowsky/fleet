#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

usage() {
	cat >&2 <<'USAGE'
usage: sync.sh [--apply]

Brings ~/.pi, ~/.omp and ~/.claude in line with this repository: installs its
dependencies, links the CLIs, renders each harness's host seat (a file gone
from here disappears there), aligns Claude's settings, hooks and the herdr
config, rebuilds a container image whose rendered seat changed, and removes
what nothing uses: leftovers of the old per-harness setup, npm packages pi no
longer lists, task directories of removed containers that never started,
settings backups and dangling links. Without --apply it prints what it would
change and changes nothing.
USAGE
	exit 2
}

apply=0
case "${1:-}" in
	--apply) apply=1 ;;
	"") ;;
	*) usage ;;
esac

ROOT="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/harness-sync.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
STAMPS="$HOME/.cache/harness/images"
LEFTOVERS=(
	"$HOME/.pi/node_modules"
	"$HOME/.omp/node_modules"
	"$HOME/.omp/agent/models.json"
	"$HOME/.pi/artifacts"
	"$HOME/.pi/.claude"
	"$HOME/.claude/settings.json.bak"
	"$HOME/sbx-kits"
	"$HOME/.codex"
)
changes=0

act() {
	changes=$((changes + 1))
	printf '  %s\n' "$*"
	if [ "$apply" = 1 ]; then "$@"; fi
}

harnesses() {
	node --input-type=module -e '
		const root = process.argv[1];
		const { HARNESSES } = await import(`${root}/src/harness.ts`);
		const { OWNED } = await import(`${root}/src/render/render.ts`);
		for (const h of Object.values(HARNESSES)) console.log(h.name, h.cli, h.home, h.image, OWNED[h.name].join(","));
	' "$ROOT"
}

drift() {
	local from="$1" to="$2" owned="$3" f d
	while IFS= read -r -d '' f; do
		f="${f#"$from"/}"
		cmp -s "$from/$f" "$to/$f" || printf 'write  %s\n' "${to/#"$HOME"/\~}/$f"
	done < <(find "$from" -type f -print0)
	for d in ${owned//,/ }; do
		[ -d "$to/$d" ] || continue
		while IFS= read -r -d '' f; do
			f="${f#"$to"/}"
			[ -e "$from/$f" ] || printf 'remove %s\n' "${to/#"$HOME"/\~}/$f"
		done < <(find "$to/$d" -type f -print0)
	done
}

seat_hash() {
	(cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256; shasum -a 256 < "$2"; printf '%s\n' "${3-}") | shasum -a 256 | cut -c1-64
}

image_agent_version() {
	[ "$1" = claude ] && claude --version 2>/dev/null | tr -cd '0-9.' || true
}

template_loaded() {
	sbx template ls --json 2>/dev/null | jq -e --arg r "${1%%:*}" --arg t "${1##*:}" \
		'.images[] | select((.repository | endswith("/" + $r)) and .tag == $t)' >/dev/null
}

HARNESS_ROWS="$(harnesses)"

echo "== dependencies"
if [ ! -f "$ROOT/node_modules/.package-lock.json" ] || [ "$ROOT/package-lock.json" -nt "$ROOT/node_modules/.package-lock.json" ]; then
	act npm ci --prefix "$ROOT"
fi

echo "== commands"
[ -d "$HOME/.local/bin" ] || act mkdir -p "$HOME/.local/bin"
while read -r name cli home image owned <&3; do
	[ "$(readlink "$HOME/.local/bin/$cli" 2>/dev/null)" = "$ROOT/bin/$cli" ] || act ln -sfn "$ROOT/bin/$cli" "$HOME/.local/bin/$cli"
done 3<<<"$HARNESS_ROWS"
[ "$(readlink "$HOME/.claude/statusline.mjs" 2>/dev/null)" = "$ROOT/claude/statusline.mjs" ] || act ln -sfn "$ROOT/claude/statusline.mjs" "$HOME/.claude/statusline.mjs"

while read -r name cli home image owned <&3; do
	echo "== $name: host seat in ~/$home"
	FLEET_HARNESS="$name" node "$ROOT/src/fleet/cli.ts" render --seat host --out "$WORK/$name" >/dev/null
	stale="$(drift "$WORK/$name" "$HOME/$home" "$owned")"
	if [ -n "$stale" ]; then
		printf '%s\n' "$stale" | sed 's/^/    /'
		act "$ROOT/bin/$cli" render
	fi
done 3<<<"$HARNESS_ROWS"

echo "== claude settings, hooks and herdr config"
aligned="$(python3 "$ROOT/claude/tools/align-settings.py")"
if printf '%s\n' "$aligned" | grep -q 'Everything already aligned'; then
	:
else
	printf '%s\n' "$aligned" | sed 's/^/    /'
	act python3 "$ROOT/claude/tools/align-settings.py" --apply
fi

while read -r name cli home image owned <&3; do
	echo "== $name: image $image"
	FLEET_HARNESS="$name" node "$ROOT/src/fleet/cli.ts" render --seat container --out "$WORK/$name-image" >/dev/null
	want="$(seat_hash "$WORK/$name-image" "$ROOT/sbx/build.sh" "$(image_agent_version "$name")")"
	if [ "$want" != "$(cat "$STAMPS/$name" 2>/dev/null || true)" ] || ! template_loaded "$image"; then
		act "$ROOT/bin/$cli" build
		if [ "$apply" = 1 ]; then
			mkdir -p "$STAMPS"
			printf '%s\n' "$want" >"$STAMPS/$name"
		fi
	fi
done 3<<<"$HARNESS_ROWS"

echo "== unused"
for path in "${LEFTOVERS[@]}"; do
	if [ -e "$path" ] || [ -L "$path" ]; then act rm -rf "$path"; fi
done
for dir in "$HOME/.pi/agent/extensions" "$HOME/.omp/agent/extensions"; do
	if [ -d "$dir" ] && [ -z "$(ls -A "$dir")" ]; then act rmdir "$dir"; fi
done
for backup in "$ROOT"/claude/sbx/*.bak; do act rm -f "$backup"; done
if [ -f "$HOME/.pi/agent/npm/package.json" ]; then
	unused="$(node --input-type=module -e '
		const { readFileSync } = await import("node:fs");
		const [npm, settings] = process.argv.slice(1);
		const installed = Object.keys(JSON.parse(readFileSync(`${npm}/package.json`, "utf8")).dependencies ?? {});
		const listed = (JSON.parse(readFileSync(settings, "utf8")).packages ?? []).map((p) => p.replace(/^npm:/, "").replace(/@[^@/]+$/, ""));
		console.log(installed.filter((name) => !listed.includes(name)).join(" "));
	' "$HOME/.pi/agent/npm" "$WORK/pi/agent/settings.json")"
	if [ -n "$unused" ]; then act npm uninstall --prefix "$HOME/.pi/agent/npm" $unused; fi
fi
if live="$(sbx ls --json 2>/dev/null | jq -r '.sandboxes[].name')"; then
	for task in "$HOME"/.sandboxes/*/*/; do
		task="${task%/}"
		[ -f "$task/status.md" ] && grep -qx 'status: new' "$task/status.md" || continue
		printf '%s\n' "$live" | grep -qx "$(basename "$task")" && continue
		[ -z "$(find "$task" -type f ! -name status.md -print -quit)" ] || continue
		act rm -rf "$task"
	done
else
	echo "  sbx ls failed, so task directories stay untouched"
fi
while IFS= read -r -d '' link; do act rm "$link"; done < <(find "$HOME/.local/bin" "$HOME/.claude/hooks" -maxdepth 1 -type l ! -exec test -e {} \; -print0 2>/dev/null)

echo
if [ "$changes" = 0 ]; then
	echo "In sync: nothing to change."
elif [ "$apply" = 0 ]; then
	echo "$changes change(s) above. Re-run with --apply to make them."
else
	left=0
	while read -r name cli home image owned <&3; do
		FLEET_HARNESS="$name" node "$ROOT/src/fleet/cli.ts" render --seat host --out "$WORK/$name-check" >/dev/null
		stale="$(drift "$WORK/$name-check" "$HOME/$home" "$owned")"
		if [ -n "$stale" ]; then
			left=1
			printf '%s\n' "$stale" | sed "s/^/  $name still differs: /"
		fi
	done 3<<<"$HARNESS_ROWS"
	[ "$left" = 0 ] && echo "$changes change(s) made; every home matches this repository."
fi
