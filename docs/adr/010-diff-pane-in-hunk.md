# Show container diffs in hunk

## Status

Accepted. Replaces the view parts of [006](006-live-diff-pane.md): the delta rendering, the file list, the scrolling and the `s`, `p`, `r` and Tab keys. The rest of 006 stands: the reading of Git inside the running container, the base, the two-second cadence and the shortcut.

## Context

The person found the delta pane hard to read and wanted a view closer to GitHub's changed files. hunk 0.23.0 reviews a patch file with a file list, split or unified layout, syntax highlighting and the mouse. With `--watch` it reloads when the file changes. In a pty test it stayed on the second file while the first one changed, and it reloaded after the file was replaced by rename. `hunk diff --watch` needs a local Git checkout, and the container's checkout lives in the sandbox.

## Decision

The view runs on the host and works the same for pi and Claude. `fleet diff <sandbox> --view` reads the container's changes with the probe from 006 into `~/.fleet/cache/diff/<sandbox>.patch`, starts `hunk patch <file> --watch` in the pane, and closes the pane when hunk exits. It reads again two seconds after the previous read finishes. It replaces the file by rename, and only when the patch changed. The host strips control characters other than tab and newline before writing, because the container controls the patch. A task with several repositories reads each one and shows them in one patch, each path under its repository's name, through Git's `--src-prefix` and `--dst-prefix`. A stopped or removed container, or a failed read, leaves the file as it was. A file over 4 MiB, or an untracked file that is not a regular file, shows only its `diff --git` header.

## Consequences

The host needs hunk instead of delta. hunk's own keys replace the pane's keys. The view shows branch changes only; the uncommitted-only scope, the pause and the repository switch are gone. The pane no longer shows the base or the container's state. hunk decides when to switch to the split layout; in the 0.6-wide pane it may stay unified. The patch file stays in the cache after the pane closes, so reopening shows the last changes before the first read returns.
