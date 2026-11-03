# Rerun frozen past tickets under a variant image

## Status

Accepted. Narrows 008 for bench runs: a bench task lives under its own run directory with a copy of the primary's runbook, not under the repository's task root.

## Context

The person wants to compare a model or seat swap on real past flowMEE tickets before making it. A run should show what each variant delivered, how long it took and how many tokens it used. A run costs about an hour and $28 of the account's limit (flo-2060, 2026-11-03), so two variants on two tasks with two reps cost about eight hours, and the bench is kept for the swap no cheaper check compares. A rule change is measured with a micro-eval (018) or with the usage and screenshot reads of ordinary tickets delivered before and after it. Three facts shaped how a run can be made.

- `fleet up --model` changes only the main agent. The advisor, reviewer, explorer and researcher keep the models the image was rendered with. A flag comparing two models would measure a mix.
- A container restarted with `fleet start` loses any per-container argv. Managed settings in the image also overwrite an `-e` variable such as `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (spike of 2026-11-03).
- Headless `claude -p` runs inside a working container shared its OAuth login, and twice logged the container's agent out (spike R1).

## Decision

A variant is a rendered image tag. `fleet build --tag <variant> [--root <worktree>]` renders a harness checkout and builds `my-<agent>:<variant>` beside `v1`. Each tag has its own tar file and stamp, and `v1` keeps the stamp path it always had. Every seat comes from the render, the advisor included through its `models.json` seat. A model variant is therefore one `models.json`, and a rule or compaction variant is one commit. A build from another checkout refuses uncommitted changes in the image's sources and names the files, so a variant built from another checkout is stamped with the commit that was built. `fleet up --image my-claude:<tag>` records the tag in the sandbox manifest. Staleness for that sandbox compares against the tag's stamp, not this checkout. For pi, whose kit names its image, `sbx run -t` with the tag overrides the kit's `image:`.

A task starts from a frozen base. `fleet up --base-commit <sha>` starts a new branch at that commit and refuses a commit that is not on the base branch or a branch that already exists. The bench ticket carries a `Frozen base: <sha>` line under its first line, and `deliver-ticket` skips its branch update for such a ticket. Diffs from the merge-base stay correct, because the merge-base is the frozen commit.

Seeds and results stay outside the repository, which is public: seeds in `~/.fleet/bench/tasks/<id>/`, results in `~/.fleet/bench/runs/<tag>/<task>-<rep>/`. A run directory is the container's artifacts root. It holds its own copy of the repository's runbook, so a past tree never writes the shared one. It also holds the task directory with transcripts, plus `diff.patch`, `usage.json` and `result.json`. `result.json` records the image ref and stamp, sha256 hashes of the seed's `ticket.md` and `task.json`, and the base commit. Two runs compare only when those match. `result.json` also records the final commit and the count of uncommitted files, and `head.bundle` holds the commits from base to that head. Base plus the bundle rebuilds the final commit without a container, binary files included, which `diff.patch` cannot do: it drops binaries and large files. The diff carries the uncommitted rest. `actions` counts, from the transcripts and the task directory, the screenshots the main session and the subagents read and the browser run directories, so a variant that should walk less is measured by the targeted action recurring or not.

The runner starts no `claude` in a container. Tasks and reps come from the command line in a fixed order, with no early stop: a run that fails is recorded as `error` and stopped, and the batch goes on. A run ends at its container's first settle, so the steer asks the agent to wait for background work in the foreground and end its turn only at Done or on an open question. The runner stops each container and prints the `fleet down --force` list, because discarding containers is the person's call.

## Consequences

One build per variant replaces per-run flags, and a variant survives a restart. Variant images take disk space until someone removes them with `sbx template rm`. A run whose agent stops on the account's usage limit is `limit`, and the batch stops there, since every later rep would start, hit the same limit and burn a container start; the error names the reps left to run after the reset. A run whose agent stops on a dialog or leaves a criterion of its ticket unticked is `blocked`, and nobody answers it. The first host run, flo-1939 on 2026-11-03, delivered end to end on its frozen base.
