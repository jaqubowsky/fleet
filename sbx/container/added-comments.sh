#!/usr/bin/env bash
set -euo pipefail

base="${1:?usage: added-comments <base ref, such as origin/main>}"
cd "$(git rev-parse --show-toplevel)"
fork="$(git merge-base "$base" HEAD)"

{
	git diff -U0 --no-color --no-ext-diff "$fork" --
	git ls-files --others --exclude-standard -z | while IFS= read -r -d '' file; do
		git diff -U0 --no-color --no-ext-diff --no-index /dev/null "$file" || true
	done
} | awk '
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
	function trimmed(text) { gsub(/^[ \t]+|[ \t]+$/, "", text); return text }
	/^\+\+\+ / { file = substr($0, 7); sub(/^b\//, "", file); type = kind(file); next }
	/^@@ / { split($3, at, ","); line = substr(at[1], 2) + 0; hunk++; block["+"] = 0; block["-"] = 0; next }
	/^-/ && !/^--- / {
		if (comment("-", substr($0, 2), 0)) { removed[trimmed(substr($0, 2))] = 1; rewords[hunk] = 1 }
		next
	}
	/^\+/ {
		text = substr($0, 2)
		if (comment("+", text, line)) { n++; where[n] = file ":" line; said[n] = text; from[n] = hunk }
		line++
	}
	END {
		for (i = 1; i <= n; i++) {
			if (trimmed(said[i]) in removed) continue
			print (rewords[from[i]] ? "changed " : "added ") where[i] ": " said[i]
			found = 1
		}
		exit found
	}
'
