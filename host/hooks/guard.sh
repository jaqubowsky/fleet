#!/usr/bin/env bash
set -uo pipefail

decide() {
  jq -nc --arg d "$1" --arg r "$2" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'
  exit 0
}

payload="$(cat)"

if ! printf '%s' "$payload" | jq -e 'type == "object" and (.tool_name | type == "string") and (.tool_input | type == "object")' >/dev/null 2>&1; then
  decide deny "Guard policy error: invalid payload."
fi

tool="$(printf '%s' "$payload" | jq -r '.tool_name')"
outbound=0

case "$tool" in
  Bash)  subject="$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')" ;;
  Read|Edit|Write|NotebookEdit)
         subject="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // ""')" ;;
  Grep|Glob)
         subject="$(printf '%s' "$payload" | jq -r '(.tool_input.path // "") + " " + (.tool_input.pattern // "")')" ;;
  WebFetch)
         subject="$(printf '%s' "$payload" | jq -r '.tool_input.url // ""')"
         outbound=1 ;;
  WebSearch)
         subject="$(printf '%s' "$payload" | jq -r '.tool_input.query // ""')"
         outbound=1 ;;
  mcp__*)
         subject="$(printf '%s' "$payload" | jq -r '[.tool_input | .. | strings] | join(" ")')"
         outbound=1 ;;
  *)     decide deny "Unknown tool policy: $tool" ;;
esac

if [ -z "$subject" ] && [[ "$tool" == mcp__* ]]; then
  decide allow "MCP call has no string arguments."
fi

[ -n "$subject" ] || decide deny "Guard policy error: tool input has no policy subject."

if [ "$outbound" = 1 ]; then
  subject="$(printf '%s' "$subject" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://# #')"
fi

host_secrets='(^|[^[:alnum:]_./-])/Users/[^/[:space:]]+/(\.ssh|\.config/op|Library/Keychains|\.pi/agent/auth\.json|\.pi/agent/models-store\.json)'
home_secrets='(^|[^[:alnum:]_./-])(~|\$HOME)/(\.ssh|\.config/op|Library/Keychains|\.pi/agent/auth\.json|\.pi/agent/models-store\.json)'
delegated='(^|[;&|]|&&)[[:space:]]*sbx[[:space:]]+(exec|run|cp)([[:space:]]|$)'

scan="$(printf '%s' "$subject" | awk -v sq="'" -v dq='"' '
BEGIN { inhd = 0; keep = 0; delim = "" }
inhd {
  line = $0
  sub(/^[ \t]+/, "", line); sub(/[ \t]+$/, "", line)
  if (line == delim) { inhd = 0; next }
  if (keep) print
  next
}
{
  print
  n = index($0, "<<")
  if (n > 0) {
    rest = substr($0, n + 2)
    sub(/^-/, "", rest)
    q = substr(rest, 1, 1)
    if (q == sq || q == dq) {
      rest = substr(rest, 2)
      p = index(rest, q)
      if (p > 1) {
        delim = substr(rest, 1, p - 1)
        keep = ($0 ~ /(^|[|;&\t ])((ba|z)?sh|python3?|node|perl|ruby|env)([\t ]|$)/) ? 1 : 0
        inhd = 1
      }
    }
  }
}
')"

if printf '%s' "$scan" | grep -qE "$host_secrets"; then
  decide deny "Credential store is off limits: ~/.ssh, ~/.config/op and ~/Library/Keychains are read by the human only."
fi

if printf '%s' "$scan" | grep -qE "$home_secrets" \
   && ! printf '%s' "$subject" | grep -qE "$delegated"; then
  decide deny "Credential store is off limits: ~/.ssh, ~/.config/op and ~/Library/Keychains are read by the human only."
fi

secret_material='(sk-ant-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|-----BEGIN[[:space:]][A-Z ]*PRIVATE KEY|op://)'

if [ "$outbound" = 1 ] && printf '%s' "$subject" | grep -qE "$secret_material"; then
  decide deny "Secret material does not leave this machine in a URL, a search query or an MCP argument. If it is a false positive, the human sends it."
fi

if [ "$tool" != Bash ]; then
  decide allow "Allowed by $tool policy."
fi

cmd='(^|[;&|]|&&|-c[[:space:]]*['"'"'"])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*(sudo[[:space:]]+)?\\?'

flat="$(printf '%s' "$subject" | sed -E "s/(sbx[[:space:]]+(exec|run|cp)[[:space:]]+[^[:space:]]+|herdr[[:space:]]+[a-z-]+)/;/g; s/['\"]/ /g")"

hit() {
  printf '%s' "$subject" | grep -qE "$1" || printf '%s' "$flat" | grep -qE "$1"
}

push='git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-][^[:space:]]*)?)*[[:space:]]+push\b'

if printf '%s' "$subject" | grep -qE "$delegated"; then
  if hit "${cmd}${push}"; then
    decide deny "Containers do not push or hold a write credential. Bring the branch home with fleet land and let the human push from this Mac."
  fi

  if hit "${cmd}(git[[:space:]]+commit[^|;&]*(-S\b|--gpg-sign)|git[[:space:]]+config[^|;&]*gpgsign[[:space:]]+true)"; then
    decide deny "The signing key never enters a container. Signing happens here, on the host."
  fi
fi

if hit "${cmd}op[[:space:]]+(read|item|document|vault|whoami|signin|account)\b"; then
  decide deny "1Password is the human's. Secrets reach a sandbox as op:// references through sbx, never through the agent's shell."
fi

if hit "${cmd}security[[:space:]]+(find-(generic|internet)-password|export|dump-keychain)"; then
  decide deny "The keychain is read by the human only. Ask for the value instead of pulling it out of the store."
fi

if hit "${cmd}git([[:space:]]+-[^[:space:]]+)*[[:space:]]+commit-tree\b"; then
  decide deny "commit-tree makes an unsigned commit behind the signing rule. A refused command is a stop, not a puzzle: ask the human."
fi

if hit "${cmd}ssh-keygen[[:space:]]+-Y[[:space:]]+sign"; then
  decide deny "Signing by hand is not how a commit gets signed here; git does it with the key behind Touch ID."
fi

if hit "${cmd}${push}[^|;&]*(--force\b|--force-with-lease\b|[[:space:]]-f\b|--delete\b|--mirror\b|[[:space:]]:[^[:space:]]+)"; then
  decide deny "A force, delete or mirror push rewrites what other people already hold. Touch ID authorises the key, not the history, so this one stays the human's own command."
fi

if hit "${cmd}(git[[:space:]]+config[^|;&]*gpgsign[[:space:]]+(false|no|0)|git[^|;&]*[[:space:]]-c[[:space:]]*commit\.gpg[sS]ign=(false|no|0)|git[[:space:]]+commit[^|;&]*--no-gpg-sign)"; then
  decide deny "Every commit on this Mac is signed, and the Touch ID prompt is the evidence a person was here. Turning signing off removes that evidence."
fi

if hit "${cmd}gh[[:space:]]+((repo[[:space:]]+(sync|delete|rename|edit))|(pr[[:space:]]+(create|merge|close|edit|ready))|(release[[:space:]]+(create|edit|delete|upload))|(api[[:space:]][^|;&]*(-X[[:space:]]*(POST|PUT|PATCH|DELETE)|--method))|(secret|workflow|ssh-key|gpg-key)[[:space:]]+(set|delete|add|run|enable|disable)|(gist[[:space:]]+create))"; then
  decide deny "gh writing to the remote is a push by another name. The human opens the PR and runs the release."
fi

if hit "${cmd}(curl|wget|base64)\b[^|]*\|[[:space:]]*(sudo[[:space:]]+)?(ba|z|da|k)?sh\b"; then
  decide deny "Piping a download into a shell is the path this fleet was hardened against. Fetch, verify a checksum, then run."
fi

if hit "${cmd}(curl|wget)\b[^|]*\|[[:space:]]*(sudo[[:space:]]+)?(python3?|node|ruby|perl|php)\b"; then
  decide deny "Piping a download into an interpreter is the path this fleet was hardened against. Fetch, verify a checksum, then run."
fi

protected='(~|\$HOME|/Users/[^/[:space:]]+/(Work|Personal|my-knowledge-base|\.pi|\.ssh|\.config)|/(etc|usr|bin|sbin|var|System|Library|Applications|opt))(/|[[:space:]]|$)'
roots='(/|/home/bob(/dev)?|/Users/[^/[:space:]]+)([[:space:]]|$)'
if hit "${cmd}rm[[:space:]]+(-[[:alnum:]]*[rR][[:alnum:]]*[[:space:]]+)*-?[[:alnum:]]*[rR]"; then
  if hit "${cmd}rm[[:space:]][^;&|]*[[:space:]]$protected"; then
    decide deny "Recursive delete of a protected path. Name a path inside the working tree instead."
  fi
  if hit "${cmd}rm[[:space:]][^;&|]*[[:space:]]$roots"; then
    decide deny "Recursive delete of a home or filesystem root."
  fi
fi

if printf '%s' "$subject" | grep -qE '(^|[;&|]|&&)[[:space:]]*(sbx|herdr)([[:space:]]|$)'; then
  decide allow "sbx/herdr orchestration."
fi

if hit "${cmd}ssh([[:space:]]|$)"; then
  decide deny "Remote shell access is outside this local-only Pi fleet."
fi

if printf '%s' "$subject" | grep -qE '(^|[;&|]|&&)[[:space:]]*git[[:space:]]+(status|log|diff|show|fetch|ls-remote|ls-files|branch|rev-parse|remote|blame|describe|shortlog)\b'; then
  decide allow "Read-only git."
fi

decide allow "Allowed by Bash policy."
