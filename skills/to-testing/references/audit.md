# Browser acceptance audit

## Criterion matrix

Every source criterion appears once, with one verdict:

- `checked-in-browser`: the walkthrough observed it.
- `covered-by-existing-test`: the test ran against this checkout; cite command, test name and result.
- `out-of-scope-with-evidence`: cite the source or diff evidence that excludes it.
- `not-implemented`: cite the missing behavior. The audit stops.

Split a compound criterion when its parts need different evidence. An implementation detail is never promoted to a criterion.

## Runbook

`.pi/runbook/run.md` holds start, ready check, URL, credentials source and stop. `features/<screen>.md` holds what a screen does, how a user reaches it, how to drive it with `agent-browser`, and its gotchas. `gotchas.md` holds what does not take a scripted action and the workaround.

Missing runbook: read `AGENTS.md`, `CLAUDE.md`, `README`, `package.json`, `Makefile`, compose files and start from checked-in commands. A command you cannot find in the repository is a stopped audit, never a guess. Keep a scratch log for this run in `/tmp`: every command with its outcome, every route, every action that failed and what worked instead.

## Maintain the runbook

Written after cleanup, so the stop commands are proven too. Source is the scratch log, not memory.

- `run.md`: the start, ready check and stop commands exactly as they ran. A ready check that never confirmed is not a ready check.
- `features/<screen>.md`: one file per screen this run drove, with the route taken and the `agent-browser` actions that worked. An existing file gets corrected where this run diverged; a screen this run did not touch is left alone.
- `gotchas.md`: an entry only for an action that failed this run and its workaround. An existing entry whose failure did not reproduce this run is deleted.
- Each file stays under 150 lines; over the limit, cut the oldest entries that this run did not exercise.

The report's "Runbook changes" section names every file touched and why.

## Prove the checkout

Before startup record branch, commit, `git status --porcelain` and a hash of the diff against `HEAD`. Record the launch command, process working directory and the URL that answered. A reachable URL whose process does not run from this checkout is a failed audit.

Use only test identities the runbook names or credentials the sandbox already holds. Credential values never enter a report, a screenshot or a recording.

## Browser

Load the installed CLI's current instructions before the first action:

```bash
agent-browser skills get core --full
agent-browser session id --scope worktree --prefix to-testing
```

Prefer the accessibility snapshot for text and state. Screenshot only a state the snapshot cannot prove: scroll the element into view, capture the smallest useful viewport, assign it to exactly one criterion. Full-page only when one criterion covers the whole page, with the reason in the artifact table. Record video only when the criterion depends on motion, ordering or transient state, and play it back before keeping it.

Walk the primary flow of every `checked-in-browser` criterion, then the risk states the diff introduces: changed validation branches, empty results, permissions, retries, destructive confirmations, loading transitions, viewport behavior. Only risks the diff supports.

## Verdict and cleanup

Stop on the first failure, checkout mismatch, missing prerequisite or `not-implemented`. Cleanup runs on every exit: close the browser session, stop every process the audit started, confirm the ports no longer answer. Evidence of a failed audit is deleted; evidence of a passed one moves into `.pi/to-testing/<run-id>/`.

Publication, pushes and merges stay with the person. Post to Linear only when the person tells you to.
