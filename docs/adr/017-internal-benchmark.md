# Rerun frozen past tickets under a variant image

## Status

Accepted.

## Context

The person wants to compare harness changes and models on real past flowMEE tickets before shipping them. A run should show which variant did work they would merge, how closely it followed the harness, how long it took and how many tokens it used. Three facts shaped how a run can be made.

- `fleet up --model` changes only the main agent. The advisor, reviewer, explorer and researcher keep the models the image was rendered with. A flag comparing two models would measure a mix.
- A container restarted with `fleet start` loses any per-container argv. Managed settings in the image also overwrite an `-e` variable such as `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (spike of 2026-11-03).
- Headless `claude -p` runs inside a working container shared its OAuth login, and twice logged the container's agent out (spike R1).

## Decision

A variant is a rendered image tag. `fleet build --tag <variant> [--root <worktree>]` renders a harness checkout and builds `my-<agent>:<variant>` beside `v1`. Each tag has its own tar file and stamp, and `v1` keeps the stamp path it always had. Every seat comes from the render, the advisor included through its `models.json` seat. A model variant is therefore one `models.json`, and a rule or compaction variant is one commit. `fleet up --image my-claude:<tag>` records the tag in the sandbox manifest. Staleness for that sandbox compares against the tag's stamp, not this checkout. Pi refuses `--image`, because its tag lives in the kit's `image:` and nobody has checked that `sbx run -t` overrides it.

A task starts from a frozen base. `fleet up --base-commit <sha>` starts a new branch at that commit and refuses a commit that is not on the base branch or a branch that already exists. The bench ticket carries a `Frozen base: <sha>` line under its first line, and `deliver-ticket` skips its branch update for such a ticket. Diffs from the merge-base stay correct, because the merge-base is the frozen commit.

Seeds and results stay outside the repository, which is public: seeds in `~/.fleet/bench/tasks/<id>/`, results in `~/.fleet/bench/runs/<tag>/<task>-<rep>/`. A run directory is the container's artifacts root. It holds its own copy of the repository's runbook, so a past tree never writes the shared one. It also holds the task directory with transcripts, plus `diff.patch`, `usage.json` and `result.json`. `result.json` records the image ref and stamp, sha256 hashes of the seed's `ticket.md` and `task.json`, and the base commit. Two runs compare only when those match, and base plus diff rebuilds the final tree without a container. `graders` and `judge` stay `null` until the grading tickets fill them, and their output goes beside `result.json`.

The judge runs on the host or with its own API key, never inside a bench container on the agent's login. The runner starts no `claude` in a container. Tasks and reps come from the command line in a fixed order, with no early stop. The runner stops each container and prints the `fleet down --force` list, because discarding containers is the person's call.

## Consequences

One build per variant replaces per-run flags, and a variant survives a restart. Variant images take disk space until someone removes them with `sbx template rm`. Pi variants wait for a check of `sbx run -t` against a kit image. A run that ends with an open question is `blocked`, and nobody answers it, so the clarification layer of the plan needs a steer loop this runner lacks. No real container run has confirmed the runner yet: everything was proven on the fake IO, and the first host run is the check.
