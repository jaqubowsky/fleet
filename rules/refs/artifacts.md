# Task directory

One directory per task at `$FLEET_ARTIFACTS/$SANDBOX_NAME/` (`~/.sandboxes/<repo>/<sandbox>/` on the host). `{{cli}} up` creates it, `{{cli}} down` keeps it. It is the handoff between skills, between sessions and to the host: what the next reader needs is in a file here or in git.

## Files

Each file has one role and one author. The commit, the branch and the dirty state live in git; the pull request lives on GitHub; neither is copied here.

```text
status.md      current user-facing state: status, attention, summary, next step, log    every skill, throughout its run
permissions.md what each seat may do in this repository: one line per action and level    {{cli}} up
project.md     how this project does what the rules require, when host/projects/<owner>/<repo>.md exists    {{cli}} up
analysis.md    what was found: verdict, evidence, open questions    analyze-task, diagnosing-bugs
spec.md        what will be built and why                          to-tickets
issues/        NN-<slug>.md, one ticket per commit                  to-tickets; implement claims and closes them
review.md      verdict line, findings, checks read, shared seams   two-axis-review
pr.md          pull request rounds: threads answered, verdicts      babysit-pr
browser/       <run-id>/report.md, screenshots, a walkthrough video    check-feature, check-regressions, record-walkthrough
logs/          sessions/, status/, activity.jsonl, usage.json, memory.json, <skill>-<id>/ evidence    {{harness}}, {{cli}} down, any skill
```

`runbook/`, when present at the root of `$FLEET_ARTIFACTS` beside the task directories, holds shared app-start and screen-driving instructions such as `run.sh`, `run.md`, `features/<screen>.md`, `gotchas.md` or `gate-baseline.md`.

One short file per name above `logs/`. Top-level files are current state, never an archive: update them in place when their truth changes, or delete them when they no longer have a role. `analysis.md` is a snapshot anchored to the analyzed commit and is replaced by a later analysis; accepted shared decisions and scope changes update `spec.md`, while slice-only changes update their ticket. `review.md` covers only its named range: close findings from that review in its addendum. A new review replaces `review.md`, and the one it replaces moves into its `logs/review-<head-sha7>/`; `pr.md` appends one round at a time. Each `browser/<run-id>/report.md` records one browser run, including its cleanup; a new run gets a new directory. Historical and run-specific evidence stays under versioned `browser/` or `logs/<skill>-<id>/`, and the current top-level file points to it.

## status.md

```md
status: new | analyzing | implementing | reviewing | testing | ready-for-host | pr-open | blocked
attention: none | <one sentence of at most 300 characters naming the decision or input that blocks the work>

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
| `testing` | the verification of what a user sees runs, over the change or its siblings |
| `ready-for-host` | the run's last step passed with no open ticket, failed criterion or regression, every line `ticket-check` prints over `issues/` named in Summary as missing verification, and no open P0 or P1 finding other than a `host:` one; missing verification belongs in Summary, host actions in Next step, and `attention` stays `none` unless a decision blocks delivery |
| `pr-open` | a pull request is open and its latest round is answered; host actions belong in Next step, and `attention` names only a decision or input blocking delivery |

The host reads this file and nothing else to know where a task stands, and Fleet may show its projection directly to the user. That projection cuts each field at the length the template gives, so text past it never arrives. Write `## Summary` and `## Next step` in terms of delivered behavior, current observable state and the next intended outcome. Keep skill names, tool calls, commands, test phases and other execution mechanics in their canonical artifact or under `logs/`.

Write the file at each event below, before the next tool call: edit the fields the event names in place and append the Log line.

| Event | Edit |
| --- | --- |
| the `status:` value changes | `status`, Summary, Next step |
| the work starts waiting on a person | `status`, `attention`, Summary, Next step |
| a session handoff is suggested | `attention`, Summary, Next step |
| the turn ends, before the chat report | every field that no longer holds |

Summary and Next step hold only the present, so `## Log` is the run's timeline: what the host and every later session read to learn what happened, in order. Each turning point appends one line in the next write, whichever event that write is for:

| Turning point | Line |
| --- | --- |
| a finding, yours or a sub-agent's, that changes the plan or the scope | what was found; the file or log that shows it |
| a check that closes a step: the baseline, a done-check, the gate, the verification of what a user sees | its result; its log |
| a decision, yours or a person's | `Decided: <what>, because <why>`; where it is recorded |
| an approach dropped | `Dropped: <what>, because <why>`; the log that shows it |
| `analysis.md`, `spec.md` with `issues/`, `review.md`, a `pr.md` round or a browser report is written or replaced | the outcome; that file, and for `review.md` its `logs/review-<head-sha7>/` |
| a commit lands | the outcome; the commit |
| the work starts waiting on a person | what it waits on |

The log is append-only: every rewrite keeps its existing lines verbatim. The harness copies each version of this file into `logs/status/` by itself.

## analysis.md

Findings only: the verdict, what it rests on, what is out of scope, what is open, and the run it calls for. The decision on what to build is `spec.md`; the steps are the tickets. The shape is in skill `analyze-task`.

## The pipeline

A ticket, a bug report or a feature runs in this order:

1. `analyze-task`
2. `to-tickets`
3. `implement`, per ticket
4. when the work changes what a user sees: its verification, once after the run's last commit. It covers the `Seen:` criteria of the committed tickets, or a short run's accepted behaviour. `project.md` names how; without one, the check the change calls for

The short run is `analyze-task`, one `implement`, then step 4. It fits one accepted behaviour, one seam and one commit. The opening prompt overrides the choice in either direction.

A prompt with no ticket behind it ("run the build", "read this log") runs no pipeline and leaves no file but `status.md`.
