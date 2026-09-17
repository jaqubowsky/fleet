#!/usr/bin/env bash
set -euo pipefail
base="${1:?usage: base-worktree <base-commit>}"
root="$(git rev-parse --show-toplevel)"
dest="${BASE_WORKTREE:-/tmp/base}"

git -C "$root" worktree remove --force "$dest" 2>/dev/null || true
git -C "$root" worktree prune
git -C "$root" worktree add --quiet --detach "$dest" "$base"

git -C "$root" ls-files --others --ignored --exclude-standard --directory -z | while IFS= read -r -d '' path; do
  path="${path%/}"
  mkdir -p "$dest/$(dirname "$path")"
  rm -rf "${dest:?}/$path"
  ln -s "$root/$path" "$dest/$path"
done

echo "$dest"
