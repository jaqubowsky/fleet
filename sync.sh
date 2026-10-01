#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

usage() {
	cat >&2 <<'USAGE'
usage: sync.sh [--apply]

Brings the home of each agent whose CLI is on PATH, ~/.claude for claude and
~/.pi for pi, in line with this repository: installs its dependencies, links
the CLIs and the herdr config, renders each such harness's host seat (a file
gone from here disappears there), prints where the two renders differ and
whether a listed reason covers it, aligns Claude's settings and hooks, rebuilds
a container image whose rendered seat changed, and removes
what nothing uses: npm packages pi no longer lists, task directories of
removed containers that never started and dangling links. Before --apply
changes anything it packs every existing file it will write, replace or
delete into ~/.fleet/backups/<UTC timestamp>.tar.gz and prints how to
restore it; it keeps the newest 10.
It ends by naming what a new Mac lacks that it cannot set up itself, with the
step that does. Without --apply it prints what it would change and changes
nothing.
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
STAMPS="$HOME/.fleet/state/images"
changes=0
skipped=""
: >"$WORK/queue"
: >"$WORK/saved"

queue() {
	printf '%q ' "$@" >>"$WORK/queue"
	echo >>"$WORK/queue"
}

act() {
	changes=$((changes + 1))
	printf '  %s\n' "$*"
	queue "$@"
}

keep() {
	local path
	for path; do
		if [ -e "$path" ] || [ -L "$path" ]; then printf '%s\n' "${path#"$HOME"/}" >>"$WORK/saved"; fi
	done
}

back_up() {
	local archive
	archive="$BACKUPS/$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
	mkdir -p "$BACKUPS"
	sort -u "$WORK/saved" | tar -czf "$archive" -C "$HOME" -T -
	ls -1 "$BACKUPS"/*.tar.gz | sort -r | tail -n +11 | while IFS= read -r old; do rm -f "$old"; done
	echo "Backed up what this run replaces to ~${archive#"$HOME"}"
	echo "  restore: tar -xzf ~${archive#"$HOME"} -C ~"
}

stamp_image() {
	mkdir -p "$STAMPS"
	printf '%s\n' "$2" >"$STAMPS/$1"
}

fleet_paths() {
	node --input-type=module -e '
		const [root, home] = process.argv.slice(1);
		const { FLEET } = await import(`${root}/src/fleet/home.ts`);
		console.log(`${home}/${FLEET.tasks}`, `${home}/${FLEET.backups}`);
	' "$ROOT" "$HOME"
}

harnesses() {
	node --input-type=module -e '
		const root = process.argv[1];
		const { KINDS } = await import(`${root}/src/harness.ts`);
		const { OWNED } = await import(`${root}/src/render/render.ts`);
		for (const h of Object.values(KINDS)) console.log(h.name, h.home, h.image, OWNED[h.name].join(","));
	' "$ROOT"
}

drift() {
	local from="$1" to="$2" owned="$3" f d
	while IFS= read -r -d '' f; do
		f="${f#"$from"/}"
		cmp -s "$from/$f" "$to/$f" || printf 'write  %s\n' "$to/$f"
	done < <(find "$from" -type f -print0)
	for d in ${owned//,/ }; do
		[ -d "$to/$d" ] || continue
		while IFS= read -r -d '' f; do
			f="${f#"$to"/}"
			[ -e "$from/$f" ] || printf 'remove %s\n' "$to/$f"
		done < <(find "$to/$d" -type f -print0)
	done
}

render_host() {
	local name="$1" home="$2" out="$3"
	if [ -f "$HOME/$home/agent/mcp.json" ]; then
		mkdir -p "$out/agent"
		cp "$HOME/$home/agent/mcp.json" "$out/agent/mcp.json"
	fi
	FLEET_SEAT="$name" node "$ROOT/src/fleet/cli.ts" render --seat host --out "$out" >/dev/null
}

seat_hash() {
	(cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256; shasum -a 256 < "$2"; printf '%s\n' "${3-}") | shasum -a 256 | cut -c1-64
}

image_agent_version() {
	"$1" --version 2>/dev/null | tr -cd '0-9.' || true
}

link() {
	[ "$(readlink "$2" 2>/dev/null)" = "$1" ] && return
	keep "$2"
	queue mkdir -p "$(dirname "$2")"
	act ln -sfn "$1" "$2"
}

set_up() {
	grep -q "^$1 " <<<"$HARNESS_ROWS"
}

by_hand() {
	echo "== set up by hand"
	for name in $skipped; do echo "  skipped $name: no $name on PATH, so its home and image stay as they are; install it to set it up: docs/setup/01-tools.md"; done
	[ -d "$HOME/.fleet/config" ] || echo "  missing ~/.fleet/config/, your git config for the images, profiles and overlays: docs/setup/02-your-config.md"
	command -v sbx >/dev/null || echo "  missing sbx on PATH: docs/setup/01-tools.md"
	command -v herdr >/dev/null || echo "  missing herdr on PATH: docs/setup/01-tools.md"
	[ "$(zsh -ic 'type gh' 2>/dev/null | tail -1)" = "gh is $HOME/.local/bin/gh" ] || echo "  gh in a new shell is not ~/.local/bin/gh: put ~/.local/bin first on PATH and drop any gh function, such as the 1Password plugin's: docs/setup/04-github-tokens.md"
	command -v node >/dev/null || { echo "  missing node on PATH: docs/setup/01-tools.md"; return; }
	node --input-type=module -e '
		const [root, home] = process.argv.slice(1);
		const { readFileSync } = await import("node:fs");
		const { loadProfiles } = await import(`${root}/src/profile/profile.ts`);
		const { keychain, tokenNames } = await import(`${root}/src/fleet/tokens.ts`);
		const read = (path) => { try { return readFileSync(path, "utf8"); } catch { return undefined; } };
		for (const name of tokenNames(loadProfiles(read, root, home)))
			if (!keychain.has(name)) console.log(`  missing keychain token ${name}: fleet tokens set ${name}`);
	' "$ROOT" "$HOME"
}

template_loaded() {
	sbx template ls --json 2>/dev/null | jq -e --arg r "${1%%:*}" --arg t "${1##*:}" \
		'.images[] | select((.repository | endswith("/" + $r)) and .tag == $t)' >/dev/null
}

command -v node >/dev/null || { by_hand; exit 1; }
ALL_ROWS="$(harnesses)"
FLEET_PATHS="$(fleet_paths)"
read -r TASKS BACKUPS <<<"$FLEET_PATHS"
HARNESS_ROWS="$(while read -r name rest; do if command -v "$name" >/dev/null; then echo "$name $rest"; fi; done <<<"$ALL_ROWS")"
skipped="$(while read -r name rest; do if ! command -v "$name" >/dev/null; then echo "$name"; fi; done <<<"$ALL_ROWS")"
if [ -z "$HARNESS_ROWS" ]; then
	by_hand
	echo "Neither claude nor pi is on PATH, so there is nothing to set up: install the agent you use, docs/setup/01-tools.md" >&2
	exit 1
fi

echo "== dependencies"
if [ ! -f "$ROOT/node_modules/.package-lock.json" ] || [ "$ROOT/package-lock.json" -nt "$ROOT/node_modules/.package-lock.json" ]; then
	act npm ci --prefix "$ROOT"
fi

echo "== commands"
link "$ROOT/bin/fleet" "$HOME/.local/bin/fleet"
link "$ROOT/bin/gh" "$HOME/.local/bin/gh"
link "$ROOT/host/herdr.toml" "$HOME/.config/herdr/config.toml"
for rules in "$ROOT"/host/agent-detection/*.toml; do link "$rules" "$HOME/.config/herdr/agent-detection/$(basename "$rules")"; done
if set_up claude; then link "$ROOT/claude/statusline.mjs" "$HOME/.claude/statusline.mjs"; fi

while read -r name home image owned <&3; do
	echo "== $name: host seat in ~/$home"
	render_host "$name" "$home" "$WORK/$name"
	stale="$(drift "$WORK/$name" "$HOME/$home" "$owned")"
	if [ -n "$stale" ]; then
		while read -r verb path; do
			keep "$path"
			printf '    %-6s ~%s\n' "$verb" "${path#"$HOME"}"
		done <<<"$stale"
		for d in ${owned//,/ }; do keep "$HOME/$home/$d"; done
		act env FLEET_SEAT="$name" "$ROOT/bin/fleet" render
	fi
done 3<<<"$HARNESS_ROWS"

echo "== parity of the pi and claude renders"
node --input-type=module -e '
	const root = process.argv[1];
	const { realIo } = await import(`${root}/src/fleet/io.ts`);
	const { parity, parityReport } = await import(`${root}/src/render/parity.ts`);
	for (const line of parityReport(parity(root, realIo(root)))) console.log(`    ${line}`);
' "$ROOT"

if set_up claude; then
	echo "== claude settings and hooks"
	aligned="$(python3 "$ROOT/claude/tools/align-settings.py")"
	if ! printf '%s\n' "$aligned" | grep -q 'Everything already aligned'; then
		printf '%s\n' "$aligned" | sed 's/^/    /'
		while IFS= read -r path; do keep "$path"; done < <(python3 "$ROOT/claude/tools/align-settings.py" --targets)
		act python3 "$ROOT/claude/tools/align-settings.py" --apply
	fi
fi

while read -r name home image owned <&3; do
	echo "== $name: image $image"
	FLEET_SEAT="$name" node "$ROOT/src/fleet/cli.ts" render --seat container --out "$WORK/$name-image" >/dev/null
	want="$(seat_hash "$WORK/$name-image" "$ROOT/sbx/build.sh" "$(image_agent_version "$name")")"
	if [ "$want" != "$(cat "$STAMPS/$name" 2>/dev/null || true)" ] || ! template_loaded "$image"; then
		act "$ROOT/bin/fleet" build "--$name"
		queue stamp_image "$name" "$want"
	fi
done 3<<<"$HARNESS_ROWS"

echo "== unused"
extensions="$HOME/.pi/agent/extensions"
if set_up pi && [ -d "$extensions" ] && [ -z "$(ls -A "$extensions")" ]; then
	keep "$extensions"
	act rmdir "$extensions"
fi
if set_up pi && [ -f "$HOME/.pi/agent/npm/package.json" ]; then
	unused="$(node --input-type=module -e '
		const { readFileSync } = await import("node:fs");
		const [npm, settings] = process.argv.slice(1);
		const installed = Object.keys(JSON.parse(readFileSync(`${npm}/package.json`, "utf8")).dependencies ?? {});
		const listed = (JSON.parse(readFileSync(settings, "utf8")).packages ?? []).map((p) => p.replace(/^npm:/, "").replace(/@[^@/]+$/, ""));
		console.log(installed.filter((name) => !listed.includes(name)).join(" "));
	' "$HOME/.pi/agent/npm" "$WORK/pi/agent/settings.json")"
	if [ -n "$unused" ]; then
		keep "$HOME/.pi/agent/npm/package.json" "$HOME/.pi/agent/npm/package-lock.json"
		act npm uninstall --prefix "$HOME/.pi/agent/npm" $unused
	fi
fi
if live="$(sbx ls --json 2>/dev/null | jq -r '.sandboxes[].name')"; then
	for task in "$TASKS"/*/*/; do
		task="${task%/}"
		[ -f "$task/status.md" ] && grep -qx 'status: new' "$task/status.md" || continue
		printf '%s\n' "$live" | grep -qx "$(basename "$task")" && continue
		[ -z "$(find "$task" -type f ! -name status.md -print -quit)" ] || continue
		keep "$task"
		act rm -rf "$task"
	done
else
	echo "  sbx ls failed, so task directories stay untouched"
fi
while IFS= read -r -d '' link; do
	grep -qxF "${link#"$HOME"/}" "$WORK/saved" && continue
	keep "$link"
	act rm "$link"
done < <(find "$HOME/.local/bin" "$HOME/.claude/hooks" -maxdepth 1 -type l ! -exec test -e {} \; -print0 2>/dev/null)

if [ "$apply" = 1 ] && [ "$changes" != 0 ]; then
	back_up
	while IFS= read -r command <&4; do eval "$command"; done 4<"$WORK/queue"
fi

by_hand

echo
if [ "$changes" = 0 ]; then
	echo "In sync: nothing to change."
elif [ "$apply" = 0 ]; then
	echo "$changes change(s) above. Re-run with --apply to make them; it first backs up what they replace to ~/.fleet/backups/<UTC timestamp>.tar.gz."
else
	left=0
	while read -r name home image owned <&3; do
		render_host "$name" "$home" "$WORK/$name-check"
		stale="$(drift "$WORK/$name-check" "$HOME/$home" "$owned")"
		if [ -n "$stale" ]; then
			left=1
			printf '%s\n' "$stale" | sed "s/^/  $name still differs: /"
		fi
	done 3<<<"$HARNESS_ROWS"
	[ "$left" = 0 ] && echo "$changes change(s) made; every home matches this repository."
fi
