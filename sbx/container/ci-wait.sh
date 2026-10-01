#!/usr/bin/env bash
set -euo pipefail

usage="usage: ci-wait <owner>/<repo> <pr number> [reads, default 20]"

count() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
}

main() {
  local repo="${1:?$usage}" pr="${2:?$usage}" reads="${3:-20}" interval="${CI_WAIT_INTERVAL:-60}"
  local sha pending total state i
  sha="$(gh pr view "$pr" --repo "$repo" --json headRefOid --jq .headRefOid)"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "head read failed: $sha"; exit 2; }
  echo "head $sha"
  for i in $(seq 1 "$reads"); do
    sleep "$interval"
    pending="$(gh run list --repo "$repo" --commit "$sha" --json status --jq '[.[] | select(.status != "completed")] | length')" || pending=""
    total="$(gh run list --repo "$repo" --commit "$sha" --json status --jq 'length')" || total=""
    state="$(gh api "repos/$repo/commits/$sha/status" --jq .state)" || state=""
    echo "read $i/$reads: $pending of $total runs pending, status $state"
    count "$pending" && count "$total" || { echo "read failed, stop waiting"; exit 2; }
    case "$state" in success|pending|failure|error) ;; *) echo "read failed, stop waiting"; exit 2 ;; esac
    if [[ "$pending" == 0 && "$total" != 0 && "$state" != pending ]]; then
      gh run list --repo "$repo" --commit "$sha" --json name,status,conclusion,url
      gh api "repos/$repo/commits/$sha/status" --jq '{state, contexts: [.statuses[] | {context, state}]}'
      exit 0
    fi
  done
  echo "still pending after $reads reads"
  exit 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
