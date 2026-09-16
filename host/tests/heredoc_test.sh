#!/usr/bin/env bash
G="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/hooks/guard.sh}"
fails=0
probe() {
  local want="$1" label="$2" cmd="$3" got expected
  got="$(printf '%s' "$cmd" | jq -Rsc '{tool_name:"Bash",tool_input:{command:.}}' | "$G" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null)"
  expected="$want"
  [ "$expected" = pass ] && expected=allow

  if [ "$got" = "$expected" ]; then
    printf 'OK    %-5s %s\n' "$got" "$label"
    return
  fi

  fails=$((fails + 1))
  printf 'FAIL  want=%s got=%s  %s\n' "$expected" "$got" "$label"
}
probe pass "dokumentacja pisana heredokiem" "$(printf 'cat > doc.md <<%sEOF%s\nrestore ~/.ssh/config here\nEOF\n' "'" "'")"
probe deny "zwykly odczyt"                  'cat ~/.ssh/config'
probe deny "heredoc karmiacy bash"          "$(printf 'bash <<%sEOF%s\ncat ~/.ssh/id_ed25519\nEOF\n' "'" "'")"
probe deny "sciezka poza heredokiem"        "$(printf 'cat ~/.ssh/config && cat > d.md <<%sEOF%s\nx\nEOF\n' "'" "'")"
probe pass "op wymienione w heredocu"       "$(printf 'cat > d.md <<%sEOF%s\nsee ~/.config/op/plugins.sh\nEOF\n' "'" "'")"
probe deny "keychain czytany wprost"        'ls ~/Library/Keychains'
probe deny "heredoc karmiacy python"        "$(printf 'python3 <<%sEOF%s\nopen("/Users/x/.ssh/id_ed25519")\nEOF\n' "'" "'")"

printf "heredoc: %d failed\n" "$fails"
exit $(( fails > 0 ))
