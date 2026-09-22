# Task directory

One directory per task at `$FLEET_ARTIFACTS/$SANDBOX_NAME/` (`~/.sandboxes/<repo>/<sandbox>/` on the host). `fleet up` creates it, `fleet down` keeps it. It is the handoff between skills, between sessions and to the host: what the next reader needs is in a file here or in git.

## Files

Each file has one role and one author. The commit, the branch and the dirty state live in git; the pull request lives on GitHub; neither is copied here.

```text
status.md      current user-facing state: status, attention, summary, next step, log    every skill, throughout its run
analysis.md    what was found: verdict, evidence, open questions    analyze-task, diagnosing-bugs
spec.md        what will be built and why                          to-tickets
issues/        NN-<slug>.md, one ticket per commit                  to-tickets; implement claims and closes them
review.md      verdict line, findings, checks read, shared seams   two-axis-review
pr.md          pull request rounds: threads answered, verdicts      babysit-pr
browser/       <run-id>/report.md, screenshots, a walkthrough video    check-feature, check-regressions, record-walkthrough
logs/          sessions/, usage.json, <skill>-<id>/ evidence        pi, fleet down, any skill
```

`runbook/` at the root of `$FLEET_ARTIFACTS`, beside the task directories, holds how the app starts and how its screens drive (`run.sh`, `run.md`, `features/<screen>.md`, `gotchas.md`, `gate-baseline.md`); every container on the repository shares it.

One short file per name above `logs/`. Top-level files are current state, never an archive: update them in place when their truth changes, or delete them when they no longer have a role. `analysis.md` is a snapshot anchored to the analyzed commit and is replaced by a later analysis; accepted shared decisions and scope changes update `spec.md`, while slice-only changes update their ticket. A new reviewed head replaces `review.md`; `pr.md` appends one round at a time. Historical and run-specific evidence stays under versioned `browser/` or `logs/<skill>-<id>/`, and the current top-level file points to it.

## status.md

```md
status: new | analyzing | implementing | reviewing | testing | ready-for-host | pr-open | blocked
attention: none | <one sentence naming what a person has to decide or provide>

## Summary
<2-5 sentences for the host: what happened, current state, missing verification or blocker, links to canonical artifacts>

## Next step
<exact workflow continuation>

## Log
- <delivered outcome>; <canonical artifact or commit>
```

| status | holds when |
| --- | --- |
| `new` | `fleet up` laid out the task directory and no work has started |
| `analyzing` | the analysis runs |
| `blocked` | the work waits on a decision or an input only a person can give, the analysis question included; `attention` names it |
| `implementing` | a ticket is claimed, or a P0 or P1 review finding, a failed criterion or a regression is being fixed |
| `reviewing` | the review of a committed head runs |
| `testing` | a browser check of the change or of its siblings runs |
| `ready-for-host` | the run's last step passed with no open ticket, P0 or P1 finding, failed criterion or regression; `attention` names what stayed unverified or uncommitted |
| `pr-open` | a pull request is open and its latest round is answered; `attention` names what only the host or the user can do next |

The host reads this file and nothing else to know where a task stands, and Fleet may show its projection directly to the user. Write `## Summary` and `## Next step` in terms of delivered behavior, current observable state and the next intended outcome. Keep skill names, tool calls, commands, test phases and other execution mechanics in their canonical artifact or under `logs/`.

Rewrite the file whenever a completed unit changes what is true or what comes next, before long-running work or delegation, and before idle, blocked or handoff. Write it last before a chat report. Do not rewrite it for tool-by-tool activity that changes none of its fields. `## Log` grows by one line per finished deliverable, naming the outcome and ending in the file or commit that holds the detail.

## analysis.md

Findings only: the verdict, what it rests on, what is out of scope, what is open, and the run it calls for. The decision on what to build is `spec.md`; the steps are the tickets. The shape is in skill `analyze-task`.

## The pipeline

A ticket, a bug report or a feature runs, in this order: `analyze-task`, `to-tickets`, `implement` per ticket with `tdd`, `two-axis-review`, `check-feature`. `check-regressions` follows when `review.md` names a shared seam, `record-walkthrough` on the user's word. The analysis ends with one question, sent as `attention:` under `status: blocked`, that covers the run shape, the split into tickets and the test seams; the later skills ask nothing on their own. An opening prompt that says end to end answers that question in advance.

The agent shortens the run when the analysis shows one accepted behaviour, one seam and one commit: `analyze-task`, then `implement` with `tdd`, then the review, and the analysis says so. The opening prompt overrides in either direction.

A prompt with no ticket behind it ("run the build", "read this log") runs no pipeline and leaves no file but `status.md`.
