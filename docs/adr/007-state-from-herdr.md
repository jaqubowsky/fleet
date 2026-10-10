# Take task state from herdr and a closing message

## Status

Accepted. Supersedes [003](003-error-recovery.md); replaces the `status.md` parts of [001](001-stopped-containers.md), the session-handoff parts of [002](002-final-verification.md), and the final task status in `logs/usage.json` of [005](005-runtime-analytics.md).

## Context

An audit of ten container runs found 9% of container tool calls and about a quarter of pi output tokens spent writing task documents, chiefly `status.md` (187 writes). Code existed only to keep that file true: snapshots, error attention written and cleared, handoff suggestions, a watch that parsed it. Status went stale after provider errors, turns ended with a working status left behind, and conditional rules about session handoffs misfired. Every status line showed a GitHub error, because the fine-grained token cannot read checks.

## Decision

For pi and Claude, the agent writes no task state. herdr's agent state says whether a container works or has settled, and every turn ends with a four-line closing message: `Changes:`, `Checks:`, `Commits:`, `Question:`. The watch labels each settle from the pane tail (`question`, `turn ended`, `no closing message`), sends the last 15 lines with it, deduplicates on `state_change_seq`, and drops a third identical wake between steers. `fleet ls` and the wake read no pull request. Nothing replaces the session handoff: a session runs until its task ends, and automatic compaction at 400000 tokens (`src/compaction.json`) is the only bound on its context. Measured on 30 runs, response time stayed flat across context size and a fresh session per commit would cut processed input by at most 20%. The account-limit resume reads the limit from the pane tail.

## Consequences

No harness code or rule reads `status.md`; an old task directory that holds one still lists. A wake shows what the container last printed rather than a curated summary, so a container that ends a turn without the closing message wakes the host as `no closing message`. Readiness is the host's reading of the closing message, the ticket's ticks and git, not a field. `logs/activity.jsonl` stays for `fleet ls` and `logs/usage.json`.
