#!/usr/bin/env bash
set -euo pipefail

check() {
  local ticket="$1" text status
  text="$(tr -d '\r' < "$ticket")"
  status="$(sed -n 's/^Status: *//p' <<<"$text" | head -n 1)"
  [[ "$status" == done ]] || echo "$ticket: Status: ${status:-missing}, not done"
  grep '^[[:space:]]*[-*] \[ \]' <<<"$text" | sed "s|^[[:space:]]*|$ticket: unticked: |" || true
}

main() {
  local tickets=("$@") failures
  if [[ ${#tickets[@]} -eq 0 ]]; then
    shopt -s nullglob
    tickets=("${FLEET_ARTIFACTS:?}/${SANDBOX_NAME:?}"/issues/*.md)
  fi
  failures="$(for ticket in "${tickets[@]}"; do check "$ticket"; done)"
  [[ -z "$failures" ]] || { echo "$failures"; exit 1; }
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
