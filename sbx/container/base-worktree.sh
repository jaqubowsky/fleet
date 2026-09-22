#!/usr/bin/env bash
set -euo pipefail

link_ignored() {
  local root="$1" dest="$2" linked= path
  git -C "$root" ls-files --others --ignored --exclude-standard --directory -z | while IFS= read -r -d '' path; do
    path="${path%/}"
    case "$path" in "$linked"/*) continue ;; esac
    mkdir -p "$dest/$(dirname "$path")"
    rm -rf "${dest:?}/$path"
    ln -s "$root/$path" "$dest/$path"
    linked="$path"
  done
}

main() {
  local base="${1:?usage: base-worktree <base-commit>}"
  local root dest
  root="$(git rev-parse --show-toplevel)"
  dest="${BASE_WORKTREE:-/tmp/base}"

  git -C "$root" worktree remove --force "$dest" 2>/dev/null || true
  git -C "$root" worktree prune
  git -C "$root" worktree add --quiet --detach "$dest" "$base"

  link_ignored "$root" "$dest"

  echo "$dest"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
