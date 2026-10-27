#!/usr/bin/env bash
set -euo pipefail

usage="usage: ci-wait <owner>/<repo> <pr number>"

count() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
}

main() {
  [[ "$#" == 2 ]] || { echo "$usage"; exit 2; }
  local repo="$1" pr="$2" reads=20 interval="${CI_WAIT_INTERVAL:-60}"
  local sha pending total state statuses i failed=0
  sha="$(gh api "repos/$repo/pulls/$pr" --jq .head.sha)"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "head read failed: $sha"; exit 2; }
  echo "head $sha"
  for i in $(seq 1 "$reads"); do
    [[ "$i" == 1 ]] || sleep "$interval"
    pending="$(gh run list --repo "$repo" --commit "$sha" --json status --jq '[.[] | select(.status != "completed")] | length')" || pending=""
    total="$(gh run list --repo "$repo" --commit "$sha" --json status --jq 'length')" || total=""
    state="$(gh api "repos/$repo/commits/$sha/status" --jq .state)" || state=""
    statuses="$(gh api "repos/$repo/commits/$sha/status" --jq .total_count)" || statuses=""
    echo "read $i/$reads: $pending of $total runs pending, status $state, $statuses statuses"
    if ! { count "$pending" && count "$total" && count "$statuses" && [[ "$state" =~ ^(success|pending|failure|error)$ ]]; }; then
      failed=$((failed + 1))
      [[ "$failed" -lt 3 ]] || { echo "read failed, stop waiting"; exit 2; }
      continue
    fi
    failed=0
    if [[ "$pending" == 0 && "$total" != 0 && ( "$state" != pending || "$statuses" == 0 ) ]]; then
      gh run list --repo "$repo" --commit "$sha" --json name,status,conclusion,url
      gh api "repos/$repo/commits/$sha/status" --jq '{state, contexts: [.statuses[] | {context, state}]}'
      exit 0
    fi
  done
  echo "still pending after $reads reads"
  exit 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
