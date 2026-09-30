# Task directory

One directory per task at `$FLEET_ARTIFACTS/$SANDBOX_NAME/`. A single repo uses `~/.sandboxes/<repo>/<sandbox>/`; a new multi-repository task uses `~/.sandboxes/groups/<repo-names>-<hash>/<sandbox>/`. The group hash comes from the sorted full GitHub repository names, not commits or argument order. Older tasks retain their recorded path or the primary repo's path when their manifest has none. `{{cli}} up` creates it, `{{cli}} down` keeps it. It is the handoff between skills, between sessions and to the host: what the next reader needs is in a file here or in git.

## Files

Each file has one role. Git is the authority for commits, branches and dirty state; the pull request lives on GitHub. A multi-repository `status.md` and an integration test report record snapshots with every full SHA so a later reader can identify what ran.

```text
status.md      current user-facing state: status, attention, log, and the summary at a hand-off
permissions.md what each seat may do in each repository: one line per action and level; {{cli}} up writes it
repositories.json  every clone's path, base, base SHA and branch for a multi-repository task; the host keeps the authoritative copy
project.md     how the primary project does what the rules require, when ~/.config/harness/projects/<owner>/<repo>.md exists; {{cli}} up writes it
projects/      additional repos' project overlays, named by their workspace basenames, when present
ticket.md      the tracker issue this task delivers, copied at start by the host; Status and ticks are the container's
analysis.md    what was found: verdict, evidence, open questions
spec.md        what will be built and why
issues/        NN-<slug>.md, one ticket per commit
review.md      verdict line, findings, checks read, shared seams
pr.md          pull request rounds: threads answered, verdicts
browser/       <run-id>/report.md, screenshots, a walkthrough video
logs/          sessions/, status.jsonl, activity.jsonl, usage.json, memory.json from the agent and {{cli}} down; <skill>-<id>/ evidence
```

`runbook/`, when present at the root of `$FLEET_ARTIFACTS` beside the task directories, holds shared app-start and screen-driving instructions such as `run.sh`, `run.md`, `features/<screen>.md`, `gotchas.md` or `gate-baseline.md`.

One short file per name above `logs/`. Top-level files are current state, never an archive: update them in place when their truth changes, or delete them when they no longer have a role.

- `analysis.md` is a snapshot anchored to the analyzed commit; a later analysis replaces it
- accepted shared decisions and scope changes update `spec.md`; slice-only changes update their ticket
- `review.md` covers only its named range, and that review's findings close in its addendum. A new review replaces it, and the one it replaces moves into its `logs/review-<head-sha7>/`
- `pr.md` appends one round at a time
- each `browser/<run-id>/report.md` records one browser run, cleanup included; a new run gets a new directory

Historical and run-specific evidence stays under `browser/` or `logs/<skill>-<id>/`, and the current top-level file points to it.

## status.md

```md
status: new | analyzing | implementing | reviewing | testing | paused | ready-for-host | blocked
attention: none | <one sentence of at most 300 characters naming the decision or input that blocks the work>

## Summary
<2-5 sentences, at most 600 characters, for the host: what was delivered, missing verification or blocker, host actions, links to canonical artifacts>

## Repositories
<only when repositories.json exists: one line per repo with name, branch, dirty count and full HEAD SHA>

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
| `paused` | the stop the order named is reached before the run's end, such as one step of an order given step by step; `attention` names no decision |
| `ready-for-host` | the run's last step passed, or the latest review round on GitHub is answered, with no open ticket, failed criterion or regression, and no open P0 or P1 finding other than a `host:` one |

At `ready-for-host`:

- `ticket-check` prints nothing for the completed scope; an open ticket or criterion stays `blocked` with its missing input in `attention`
- every host action is named in Summary, never counted
- `attention` stays `none`

The branch's pull request, its CI and its commit counts are facts `{{cli}}` prints beside this file, never a status the agent writes. The host reads this file and those facts to know where a task stands, and Fleet may show its projection directly to the user. That projection cuts each field at the length the template gives, so text past it never arrives. Write `## Summary` in terms of delivered behavior and current observable state. Keep skill names, tool calls, commands, test phases and other execution mechanics in their canonical artifact or under `logs/`.

Write the file at each event below, before the next tool call: edit the fields the event names in place and append the Log line. For a multi-repository task, probe each `repositories.json` workspace with `git -C <workspace> branch --show-current`, `status --porcelain` and `rev-parse HEAD`; replace the `## Repositories` snapshot on every status change. Before an integration test starts, put every full HEAD SHA and any dirty diff hashes in its report. If any repo changes after the run, those results no longer prove the new set.

| Event | Edit |
| --- | --- |
| the `status:` value changes | `status`; Summary written when it turns `ready-for-host` or `blocked`, removed when it leaves them |
| the work starts waiting on a person | `status`, `attention`, Summary |
| a session handoff is suggested | `attention` |
| the turn ends, before the chat report | every field that no longer holds |

`## Log` is the run's timeline: what the host and every later session read to learn what happened, in order. A fresh session reads the current Summary and recent Log turning points, then takes its work from the frontier of `issues/`; older history stays available when the frontier needs it. Each turning point appends one line in the next write, whichever event that write is for:

| Turning point | Line |
| --- | --- |
| a finding, yours or a sub-agent's, that changes the plan or the scope | what was found; the file or log that shows it |
| a check that closes a step: the baseline, a done-check, the final gate for that step, a settled CI wait, the verification of what a user sees | the outcome and its log path; intermediate reruns and counts stay in that log |
| a decision, yours or a person's | `Decided: <what>, because <why>`; where it is recorded |
| an approach dropped | `Dropped: <what>, because <why>`; the log that shows it |
| `analysis.md`, `spec.md` with `issues/`, `review.md`, a `pr.md` round or a browser report is written or replaced | the outcome; that file, and for `review.md` its `logs/review-<head-sha7>/` |
| a commit lands | the outcome; the commit |
| the work starts waiting on a person | what it waits on |

The log is append-only: every rewrite keeps its existing lines verbatim. The harness adds a line for each change of this file to `logs/status.jsonl` by itself.

## analysis.md

Findings only: the verdict, what it rests on, what is out of scope, what is open, and the run it calls for. The decision on what to build is `spec.md`; the steps are the tickets.
