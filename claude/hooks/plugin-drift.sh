#!/usr/bin/env bash
set -uo pipefail

cat >/dev/null

state="$HOME/.claude/plugins/installed_plugins.json"
markets="$HOME/.claude/plugins/known_marketplaces.json"
baseline="$HOME/.fleet/state/plugins-baseline.json"

[ -r "$state" ] || exit 0

fingerprint() {
  jq -S '[
    (.plugins // {}) | to_entries[] as $p
    | $p.value[]
    | {id: $p.key, scope: .scope, version: .version, sha: (.gitCommitSha // "none")}
  ]' "$state"
}

emit() {
  jq -nc --arg m "$1" --arg c "$2" \
    '{systemMessage:$m, hookSpecificOutput:{hookEventName:"SessionStart", additionalContext:$c}}'
  exit 0
}

current="$(fingerprint)"

if [ ! -r "$baseline" ]; then
  mkdir -p "$(dirname "$baseline")"
  printf '%s\n' "$current" > "$baseline"
  count="$(printf '%s' "$current" | jq 'length')"
  emit "Plugin baseline recorded: $count entries." "Plugin baseline was missing and has been written from the current state ($count entries). Nothing was verified this session."
fi

if [ "$(printf '%s' "$current" | jq -S -c .)" = "$(jq -S -c . "$baseline")" ]; then
  exit 0
fi

added="$(jq -n --argjson a "$current" --slurpfile b "$baseline" '$a - $b[0] | map("+ \(.id) \(.scope) \(.version) \(.sha)") | join("\n")')"
removed="$(jq -n --argjson a "$current" --slurpfile b "$baseline" '$b[0] - $a | map("- \(.id) \(.scope) \(.version) \(.sha)") | join("\n")')"
market="$(jq -r 'to_entries | map("\(.key) lastUpdated=\(.value.lastUpdated // "?") autoUpdate=\(.value.autoUpdate // true)") | join("\n")' "$markets" 2>/dev/null)"

detail="Installed plugins differ from the recorded baseline.
$(printf '%s' "$added" | jq -r .)
$(printf '%s' "$removed" | jq -r .)
Marketplaces: $market
Baseline: $baseline
Review the change before using any plugin. Accept it by deleting the baseline file, which rewrites it next session."

emit "Plugin drift detected — see the note above before using a plugin." "$detail"
