#!/usr/bin/env bash
set -euo pipefail

usage="usage: ci-wait <owner>/<repo> <pr number>"

count() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
}

shas() {
  ! grep -qvxE '([0-9a-f]{40})?' <<<"$1"
}

summary_note() {
  [[ "$1" =~ ^(([0-9a-f]{40}|none)\ (pending|reviewing|review-paused|skip-review|rate-limited|failure))?$ ]]
}

main() {
  [[ "$#" == 2 ]] || { echo "$usage"; exit 2; }
  local repo="$1" pr="$2" reads=20 interval="${CI_WAIT_INTERVAL:-60}"
  local sha pending total ran ci state statuses summary reviews assessed note coderabbit skipped i failed=0
  sha="$(gh api "repos/$repo/pulls/$pr" --jq .head.sha)"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "head read failed: $sha"; exit 2; }
  echo "head $sha"
  for i in $(seq 1 "$reads"); do
    [[ "$i" == 1 ]] || sleep "$interval"
    pending="$(gh run list --repo "$repo" --commit "$sha" --json status --jq '[.[] | select(.status != "completed")] | length')" || pending=""
    total="$(gh run list --repo "$repo" --commit "$sha" --json status --jq 'length')" || total=""
    ran="$(gh run list --repo "$repo" --commit "$sha" --json conclusion --jq '[.[].conclusion] - ["skipped"] | length')" || ran=""
    state="$(gh api "repos/$repo/commits/$sha/status" --jq .state)" || state=""
    statuses="$(gh api "repos/$repo/commits/$sha/status" --jq .total_count)" || statuses=""
    summary="$(gh api --paginate "repos/$repo/issues/$pr/comments" --jq '.[] | select(.user.login == "coderabbitai[bot]") | .body | select(test("auto-generated comment: summarize by coderabbit")) | "\(capture("change_assessment_commit:\"(?<sha>[0-9a-f]{40})\"").sha // "none") \(if test("auto-generated comment: review in progress by coderabbit") then "reviewing" else ([scan("auto-generated comment: (review paused|skip review|rate limited|failure) by coderabbit")[0]][0] // "pending" | gsub(" "; "-")) end)"')" || summary="failed"
    summary="${summary%%$'\n'*}"
    reviews="$(gh api --paginate "repos/$repo/pulls/$pr/reviews" --jq '.[] | select(.user.login == "coderabbitai[bot]" and .body != "") | .commit_id')" || reviews="failed"
    read -r assessed note <<<"$summary" || true
    coderabbit=""
    skipped=""
    if [[ -n "$summary" && "$assessed" != "$sha" ]] && ! grep -qx "$sha" <<<"$reviews"; then
      case "$note" in
        pending|reviewing) coderabbit=", coderabbit $note" ;;
        *) skipped="coderabbit $note, so this wait ends without its review of $sha" ;;
      esac
    fi
    echo "read $i/$reads: $pending of $total runs pending, status $state, $statuses statuses$coderabbit${skipped:+, $note}"
    if ! { count "$pending" && count "$total" && count "$ran" && count "$statuses" && [[ "$state" =~ ^(success|pending|failure|error)$ ]] && summary_note "$summary" && shas "$reviews"; }; then
      failed=$((failed + 1))
      [[ "$failed" -lt 3 ]] || { echo "read failed, stop waiting"; exit 2; }
      continue
    fi
    failed=0
    if [[ "$total" == 0 && "$(gh api "repos/$repo/pulls/$pr" --jq .mergeable_state || true)" == dirty ]]; then
      echo "head $sha conflicts with its base, so no run will start until the conflict is resolved"
      exit 3
    fi
    ci=""
    if [[ "$pending" == 0 && "$total" != 0 && "$ran" == 0 ]]; then ci="no check ran on $sha: every run was skipped"; fi
    if [[ "$total" == 0 && -n "$summary" && "$i" -ge 3 ]]; then ci="no run registered on $sha"; fi
    if [[ -z "$coderabbit" ]] && { [[ -n "$ci" ]] || [[ "$pending" == 0 && "$total" != 0 && ( "$state" != pending || "$statuses" == 0 ) ]]; }; then
      [[ -z "$skipped" ]] || echo "$skipped"
      [[ -z "$ci" ]] || echo "$ci"
      gh run list --repo "$repo" --commit "$sha" --json name,status,conclusion,url
      gh api "repos/$repo/commits/$sha/status" --jq '{state, contexts: [.statuses[] | {context, state}]}'
      exit 0
    fi
  done
  echo "still pending after $reads reads"
  exit 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
