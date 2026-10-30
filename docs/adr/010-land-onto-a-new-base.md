# Land onto a new base, and skip repositories without work

## Status

Accepted.

## Context

`fleet up` records each repository's base branch, the base commit and the task branch in the task's manifest. `fleet land` used to trust that record for the whole task. The audit of 2026-10-16 found three ways the record went stale on flowMEE:

- Origin deleted a stacked base branch after its pull request merged, so `git fetch origin <base>` failed (exit 128).
- The host itself asked the container to rebase onto `origin/main`. The rebased branch no longer descended from the recorded base commit, so preflight refused it.
- In a four-repository container, the work sat on a branch other than the recorded one. `--branch` was refused because several repositories were recorded, and three of them held no work: each was detached at a commit from origin.

The host moved the work by `git bundle` eight times instead. No landed ref was recorded, so `fleet down` refused to close those containers. It also refused a maspex-foto container whose second repository had no commit beyond its base, and a flowMEE container whose second repository was detached at a commit from origin. The person ran `--force` three times, and a fourth waited for them.

That last refusal named an empty commit. The checkout probe prints the branch first, and a detached head leaves it empty. The shell output is trimmed, so the parser shifted every field.

## Decision

For pi and Claude alike:

- `fleet land --base <branch>` replaces the recorded base of the repository being landed. The new base commit is the merge base of the incoming branch and `origin/<branch>`. The manifest is saved once every preflight has passed. The check that the branch descends from its base then runs against that merge base.
- A multi-repository land skips a repository that is on its recorded base commit, or detached at a commit a remote-tracking ref of its clone contains, as long as it has no uncommitted files. `--branch` and `--base` act on the one repository left, and are refused when more than one holds work.
- The failed base fetch and the history refusal both name `--base` in their error.
- `fleet down` passes each repository of the task whose head is its recorded base commit, is under its landed ref, or is on a remote-tracking ref of its own clone.
- The checkout parser reads two fields ending in a commit as a detached head.

## Consequences

The host can land work after a rebase or a merged stacked base without moving it by hand, and `fleet down` closes containers whose extra repositories only hold commits from origin.

`--base` weakens the history check: any branch that shares history with `origin/<branch>` passes. Only the host's explicit flag triggers it, and the guard asks the person before every `fleet land`.

A repository skipped as detached can still hold commits on a branch it is not on. Neither `land` nor `down` looks at those, the same as before.
