#!/usr/bin/env bash
set -uo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
guard="$dir/../hooks/guard.sh"
[ -x "$guard" ] || { echo "run.sh: $guard is not executable" >&2; exit 2; }

payload() {
  case "$1" in
    Bash)      jq -nc --arg t "$1" --arg v "$2" '{tool_name:$t,tool_input:{command:$v}}' ;;
    Grep|Glob) jq -nc --arg t "$1" --arg v "$2" '{tool_name:$t,tool_input:{path:$v}}' ;;
    WebFetch)  jq -nc --arg t "$1" --arg v "$2" '{tool_name:$t,tool_input:{url:$v,prompt:"summarise"}}' ;;
    WebSearch) jq -nc --arg t "$1" --arg v "$2" '{tool_name:$t,tool_input:{query:$v}}' ;;
    mcp__*)    jq -nc --arg t "$1" --arg v "$2" '{tool_name:$t,tool_input:{title:$v}}' ;;
    *)         jq -nc --arg t "$1" --arg v "$2" '{tool_name:$t,tool_input:{file_path:$v}}' ;;
  esac
}

pass=0
fail=0
for f in "$dir"/cases-*.tsv; do
  while IFS=$'\t' read -r want tool subject; do
    [ -n "${want:-}" ] || continue
    case "$want" in \#*) continue ;; esac
    got="$(payload "$tool" "$subject" | "$guard" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null)"
    [ -n "$got" ] || got=invalid
    expected="$want"
    [ "$expected" = pass ] && expected=allow
    if [ "$got" = "$expected" ]; then pass=$((pass + 1)); else
      fail=$((fail + 1))
      printf 'FAIL  %s  want=%-5s got=%-7s  %s\n' "${f##*/}" "$expected" "$got" "$subject"
    fi
  done < "$f"
done
printf 'guard.sh: %d passed, %d failed\n' "$pass" "$fail"

skills=0
for skill in "$dir"/../../skills/*/SKILL.md; do
  out="$(PI_OFFLINE=1 pi --no-extensions --no-context-files --no-tools --no-skills --skill "$skill" --help 2>&1 | grep -E '^(Warning|Error)')"
  [ -z "$out" ] && continue
  skills=$((skills + 1))
  printf 'FAIL  skill  %s: %s\n' "$(basename "$(dirname "$skill")")" "$out"
done
printf 'skills: %d failed to load\n' "$skills"

node "$dir/extension_guard_test.mjs"; behavior=$?
node "$dir/extension_syntax_test.mjs"; syntax=$?
"$dir/heredoc_test.sh" "$guard" | grep -E '^(FAIL|heredoc:)'; heredoc=${PIPESTATUS[0]}

[ "$fail" -eq 0 ] && [ "$skills" -eq 0 ] && [ "$behavior" -eq 0 ] && [ "$syntax" -eq 0 ] && [ "$heredoc" -eq 0 ]
