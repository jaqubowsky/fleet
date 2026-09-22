# Task directory

One directory per task at `$FLEET_ARTIFACTS/$SANDBOX_NAME/` (`~/.sandboxes/<repo>/<sandbox>/` on the host). `fleet up` creates it, `fleet down` keeps it. It is the handoff between skills, between sessions and to the host: what the next reader needs is in a file here or in git.

## Files

Each file has one role and one author. The commit, the branch and the dirty state live in git; the pull request lives on GitHub; neither is copied here.

```text
status.md      where it stands: status, attention, plan            every skill, as its last write
analysis.md    what was found: verdict, evidence, open questions    analyze-task, diagnosing-bugs
spec.md        what will be built and why                          to-spec
issues/        NN-<slug>.md, one ticket per commit                  to-tickets; implement claims and closes them
review.md      findings and the checks read, against one commit    two-axis-review
pr.md          pull request rounds: threads answered, verdicts      babysit-pr
to-testing/    <run-id>/report.md with its screenshots and video    to-testing
logs/          sessions/, usage.json, <skill>-<id>/ evidence        pi, fleet down, any skill
```

One short file per name above `logs/`. Anything with many versions, big or binary goes to `logs/<skill>-<id>/`, and the file that cites it links there.

## status.md

```md
status: new | analyzing | implementing | reviewing | testing | ready-for-host | pr-open | blocked | done
attention: none | <one sentence naming what a person has to decide or provide>

## Plan
- [x] <step>
- [ ] <step>
```

The first unchecked step is the current work. `attention` is the line a person reads: at `blocked` it names the decision or the missing piece, at `ready-for-host` what stayed unverified or uncommitted. A skill writes this file last, before its chat report.

## analysis.md

Findings only: the verdict, what it rests on, what is out of scope, what is open. The decision on what to build is `spec.md`; the steps are the plan. The shape is in skill `analyze-task`.

## The pipeline

A ticket, a bug report or a feature runs, in this order: `analyze-task`, `to-spec`, `to-tickets`, `implement` per ticket with `tdd`, `two-axis-review`, `to-testing`. The analysis ends with one question that covers the verdict, the split into tickets and the test seams; the later skills ask nothing on their own. An opening prompt that says end to end answers that question in advance.

The agent shortens the run when the analysis shows one accepted behaviour, one seam and one commit: `analyze-task`, then `implement` with `tdd`, then the review, and the first plan step says so. The opening prompt overrides in either direction.

A prompt with no ticket behind it ("run the build", "read this log") runs no pipeline and leaves no file but `status.md`.
