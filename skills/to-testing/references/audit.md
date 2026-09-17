# Browser acceptance audit

## Criterion matrix

Every source criterion appears once, with one verdict:

- `checked-in-browser`: the walkthrough observed it.
- `covered-by-existing-test`: the test ran against this checkout; cite command, test name and result.
- `out-of-scope-with-evidence`: cite the source or diff evidence that excludes it.
- `not-implemented`: cite the missing behavior. The audit stops.

Split a compound criterion when its parts need different evidence. An implementation detail is never promoted to a criterion.

## Runbook

`run.sh start` brings the application up, waits for ready and prints the URL; `run.sh stop` takes down what it started and confirms the ports fall silent. The audit starts and stops through it, and a run that fails there reports a stale runbook rather than working around it by hand. It earns its place once startup takes more than one checked-in command; a single `pnpm dev` stays in prose. `run.md` holds what `run.sh` does, the credentials source, and one line per environment workaround the script carries with the reason it is there. `features/<screen>.md` holds what a screen does, how a user reaches it, how to drive it with `agent-browser`, and its gotchas. `gotchas.md` holds what does not take a scripted action and the workaround.

Missing runbook: read `AGENTS.md`, `CLAUDE.md`, `README`, `package.json`, `Makefile`, compose files and start from checked-in commands. A command you cannot find in the repository is a stopped audit, never a guess. Keep a scratch log for this run in `/tmp`: every command with its outcome, every route, every action that failed and what worked instead.

## Maintain the runbook

Written after cleanup, so the stop commands are proven too. Source is the scratch log, not memory.

- `run.sh`: `set -euo pipefail`, one argument (`start`, `stop`), the commands exactly as they ran this audit. A ready check that never confirmed is not a ready check.
- `run.md`: what `run.sh` does, the credentials source and the workaround reasons. A project still on prose keeps its start, ready check, URL and stop here.
- `features/<screen>.md`: one file per screen this run drove, with the route taken and the `agent-browser` actions that worked. An existing file gets corrected where this run diverged; a screen this run did not touch is left alone.
- `gotchas.md`: an entry only for an action that failed this run and its workaround. An existing entry whose failure did not reproduce this run is deleted.
- Each markdown file stays under 150 lines; over the limit, cut the oldest entries that this run did not exercise.

The report's "Runbook changes" section names every file touched and why.

## Prove the checkout

Before startup record branch, commit, `git status --porcelain` and a hash of the diff against `HEAD`. Record the launch command, process working directory and the URL that answered. A reachable URL whose process does not run from this checkout is a failed audit.

Use only test identities the runbook names or credentials the sandbox already holds. Credential values never enter a report, a screenshot or a recording.

## Browser

Load the installed CLI's current instructions whole before the first action, since the commands you need sit past the first screenful:

```bash
agent-browser skills get core --full
agent-browser session id --scope worktree --prefix to-testing
```

Prefer the accessibility snapshot for text and state.

Every capture runs at Full HD, unless the criterion turns on a smaller screen, which sets its own size and names it in the artifact table:

```bash
agent-browser set viewport 1920 1080
```

Record video for every criterion that takes more than one action: a form driven field by field, a flow crossing screens, motion, ordering, transient state. Play it back before keeping it, and caption it in the report with what happens, in order. Bring whatever names the subject of the action into frame first, so the recording shows which row, record or document changed; recording starts on the criterion's first action and stops on its observed result. The commands, the cursor a recording otherwise lacks and the actions that move it are in [recording a flow](recording.md).

Screenshot a single settled state the snapshot cannot prove. Scroll that state into view and capture the whole viewport; `agent-browser highlight <sel>` marks the element that matters while the rest of the screen stays readable. Each shot carries a caption in the report saying what it shows and where to look, and belongs to exactly one criterion. Full-page only when one criterion covers the whole page, with the reason in the artifact table.

Walk the primary flow of every `checked-in-browser` criterion, then the risk states the diff introduces: changed validation branches, empty results, permissions, retries, destructive confirmations, loading transitions, viewport behavior. Only risks the diff supports.

## Verdict and cleanup

Stop on the first failure, checkout mismatch, missing prerequisite or `not-implemented`. Cleanup runs on every exit: close the browser session, run `run.sh stop` or the prose stop commands, confirm the ports no longer answer. Evidence of a failed audit is deleted; evidence of a passed one moves in beside the report.

Publication, pushes and merges stay with the person. Post to Linear only when the person tells you to.
