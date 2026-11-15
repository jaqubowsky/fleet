#!/usr/bin/env bash
set -euo pipefail

usage="usage: touched-comments --added|--all <base ref>, such as origin/main"
mode="${1:-}"
base="${2:-}"
if [[ "$mode" != --added && "$mode" != --all ]] || [[ -z "$base" ]]; then
	echo "$usage" >&2
	exit 2
fi
cd "$(git rev-parse --show-toplevel)"
fork="$(git merge-base "$base" HEAD)"

whole() {
	while IFS= read -r -d '' file; do
		git diff -U0 --no-color --no-ext-diff --no-index /dev/null "$file" || true
	done
}

{
	if [[ "$mode" == --added ]]; then
		git diff -U0 --no-color --no-ext-diff "$fork" --
	else
		git diff --name-only -z --diff-filter=ACMR "$fork" -- | whole
	fi
	git ls-files --others --exclude-standard -z | whole
} | awk -v mode="$mode" '
	function kind(path) {
		if (path ~ /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|java|kt|kts|go|rs|c|h|cc|cpp|hpp|cs|swift|scala|dart|php|prisma|css|scss|less|vue|svelte|groovy)$/) return "slash"
		if (path ~ /\.sql$/) return "sql"
		if (path ~ /\.(py|sh|bash|zsh|rb|pl)$/) return "hash"
		return ""
	}
	function comment(side, text, at) {
		if (block[side]) {
			if (text ~ /\*\//) block[side] = 0
			return 1
		}
		if ((type == "slash" || type == "sql") && text ~ /^[ \t]*\{?\/\*/) {
			if (text !~ /\*\//) block[side] = 1
			return 1
		}
		if (type == "slash") return text ~ /^[ \t]*\/\//
		if (type == "sql") return text ~ /^[ \t]*--/ && text !~ /^-- [A-Z][A-Za-z]*$/
		if (type == "hash") return text ~ /^[ \t]*#/ && !(at == 1 && text ~ /^#!/)
		return 0
	}
	function directive(text) {
		return text ~ /eslint-(disable|enable)|@ts-(expect-error|ignore|nocheck)|prettier-ignore|biome-ignore|(istanbul|c8|v8) ignore|@(vitest|jest)-environment|webpack[A-Z][A-Za-z]*:|@vite-ignore|\/\/\/ *<reference|shellcheck |noqa|type: *ignore|pylint: *disable|\/\/go:|\/\/ *\+build/
	}
	function license(text) { return tolower(text) ~ /copyright|spdx-license-identifier|@license|licensed under/ }
	function trimmed(text) { gsub(/^[ \t]+|[ \t]+$/, "", text); return text }
	/^\+\+\+ / { file = substr($0, 7); sub(/^b\//, "", file); type = kind(file); next }
	/^@@ / { split($3, at, ","); line = substr(at[1], 2) + 0; hunk++; block["+"] = 0; block["-"] = 0; next }
	/^-/ && !/^--- / {
		if (comment("-", substr($0, 2), 0)) { removed[trimmed(substr($0, 2))] = 1; rewords[hunk] = 1 }
		next
	}
	/^\+/ {
		text = substr($0, 2)
		if (comment("+", text, line)) {
			if (!(file == lastFile && line == lastLine + 1)) run++
			lastFile = file; lastLine = line
			if (license(text)) legal[run] = 1
			if (!directive(text)) { n++; where[n] = file ":" line; said[n] = text; from[n] = hunk; of[n] = run }
		}
		line++
	}
	END {
		for (i = 1; i <= n; i++) {
			if (legal[of[i]]) continue
			if (mode == "--all") label = "comment "
			else if (trimmed(said[i]) in removed) continue
			else label = rewords[from[i]] ? "changed " : "added "
			print label where[i] ": " said[i]
			found = 1
		}
		exit found
	}
'
