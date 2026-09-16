#!/usr/bin/env bash
set -uo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

skills=0
for skill in "$dir"/../../skills/*/SKILL.md; do
  out="$(PI_OFFLINE=1 pi --no-extensions --no-context-files --no-tools --no-skills --skill "$skill" --help 2>&1 | grep -E '^(Warning|Error)')"
  [ -z "$out" ] && continue
  skills=$((skills + 1))
  printf 'FAIL  skill  %s: %s\n' "$(basename "$(dirname "$skill")")" "$out"
done
printf 'skills: %d failed to load\n' "$skills"

node "$dir/extension_syntax_test.mjs"; syntax=$?

[ "$skills" -eq 0 ] && [ "$syntax" -eq 0 ]
