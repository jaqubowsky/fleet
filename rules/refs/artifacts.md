# Task directory

One directory per task at `$FLEET_ARTIFACTS/$SANDBOX_NAME/` (`~/.sandboxes/<repo>/<sandbox>/` on the host). `{{cli}} up` creates it, `{{cli}} down` keeps it. It is the handoff between skills, between sessions and to the host: what the next reader needs is in a file here or in git.

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
logs/          sessions/, status/, usage.json, <skill>-<id>/ evidence    {{harness}}, {{cli}} down, any skill
```

`runbook/`, when present at the root of `$FLEET_ARTIFACTS` beside the task directories, holds shared app-start and screen-driving instructions such as `run.sh`, `run.md`, `features/<screen>.md`, `gotchas.md` or `gate-baseline.md`.

One short file per name above `logs/`. Top-level files are current state, never an archive: update them in place when their truth changes, or delete them when they no longer have a role. `analysis.md` is a snapshot anchored to the analyzed commit and is replaced by a later analysis; accepted shared decisions and scope changes update `spec.md`, while slice-only changes update their ticket. A new review replaces `review.md`, and the one it replaces moves into its `logs/review-<head-sha7>/`; `pr.md` appends one round at a time. Historical and run-specific evidence stays under versioned `browser/` or `logs/<skill>-<id>/`, and the current top-level file points to it.

## status.md

```md
status: new | analyzing | implementing | reviewing | testing | ready-for-host | pr-open | blocked
attention: none | <one sentence of at most 300 characters naming what a person has to decide or provide>

## Summary
<2-5 sentences, at most 600 characters, for the host: what happened, current state, missing verification or blocker, links to canonical artifacts>

## Next step
<exact workflow continuation, at most 300 characters>

## Log
- <turning point>; <file, log or commit that shows it>
```

| status | holds when |
| --- | --- |
| `new` | `{{cli}} up` laid out the task directory and no work has started |
| `analyzing` | the analysis runs |
| `blocked` | the work waits on a decision or an input only a person can give, the analysis question included; `attention` names it |
| `implementing` | a ticket is claimed, or a P0 or P1 review finding, a failed criterion or a regression is being fixed |
| `reviewing` | the review of uncommitted work, or of a range the user named, runs |
| `testing` | a browser check of the change or of its siblings runs |
| `ready-for-host` | the run's last step passed with no open ticket, failed criterion or regression, and no open P0 or P1 finding other than a `host:` one; `attention` names what stayed unverified, uncommitted or left to the host |
| `pr-open` | a pull request is open and its latest round is answered; `attention` names what only the host or the user can do next |

The host reads this file and nothing else to know where a task stands, and Fleet may show its projection directly to the user. That projection cuts each field at the length the template gives, so text past it never arrives. Write `## Summary` and `## Next step` in terms of delivered behavior, current observable state and the next intended outcome. Keep skill names, tool calls, commands, test phases and other execution mechanics in their canonical artifact or under `logs/`.

Write the file at each event below, before the next tool call.

| Event | Rewrite |
| --- | --- |
| a prompt or a steer arrives, before its first command | `status`, Summary, Next step |
| a skill starts | `status`, Summary, Next step |
| a sub-agent starts or returns | `status`, Summary, Next step |
| `analysis.md`, `spec.md` with `issues/`, `review.md`, a `pr.md` round or a browser report is written or replaced | `status`, Summary, Next step |
| a commit lands | `status`, Summary, Next step |
| the work waits on a person | `status`, `attention`, Summary, Next step |
| a session handoff is suggested | `attention`, Summary, Next step |
| the turn ends, before the chat report | every field that no longer holds |

Summary and Next step hold only the present, so `## Log` is the run's timeline: what the host and every later session read to learn what happened, in order. Each turning point appends one line in the next write, whichever event that write is for:

| Turning point | Line |
| --- | --- |
| a finding, yours or a sub-agent's, that changes the plan or the scope | what was found; the file or log that shows it |
| a check that closes a step: the baseline, a done-check, the gate, a browser walk | its result; its log |
| a decision, yours or a person's | `Decided: <what>, because <why>`; where it is recorded |
| an approach dropped | `Dropped: <what>, because <why>`; the log that shows it |
| a file from the event table is written or replaced | the outcome; that file, and for `review.md` its `logs/review-<head-sha7>/` |
| a commit lands | the outcome; the commit |
| the work starts waiting on a person | what it waits on |

The log is append-only: every rewrite keeps its existing lines verbatim. The harness copies each version of this file into `logs/status/` by itself.

## analysis.md

Findings only: the verdict, what it rests on, what is out of scope, what is open, and the run it calls for. The decision on what to build is `spec.md`; the steps are the tickets. The shape is in skill `analyze-task`.

## The pipeline

A ticket, a bug report or a feature runs, in this order: `analyze-task`, `to-tickets`, then per ticket `implement` with `tdd` and a `two-axis-review` of its uncommitted diff before its one commit, then `check-feature` once, after the last ticket, over every criterion of the task. One review per ticket, one walk per task, however many tracker issues it spans. `check-regressions` follows when a review of the task, current or under `logs/review-*/`, names a shared seam, `record-walkthrough` on the user's word. The analysis ends with one question in `analysis.md`, named in `attention:` under `status: blocked`, that covers the run shape, the split into tickets and the test seams; the later skills ask only for a product decision nothing settled or a split no answer named. An order to deliver end to end answers that question in advance, all but such a product decision.

The agent shortens the run when the analysis shows one accepted behaviour, one seam and one commit: `analyze-task`, then `implement` with `tdd` and its review before the commit, and the analysis says so. The opening prompt overrides in either direction.

A prompt with no ticket behind it ("run the build", "read this log") runs no pipeline and leaves no file but `status.md`.
