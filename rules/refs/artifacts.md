# Task directory

One directory per task at `$FLEET_ARTIFACTS/$SANDBOX_NAME/` (`~/.sandboxes/<repo>/<sandbox>/` on the host), created by `fleet up`, kept after `fleet down`. It is the handoff between skills, between sessions and to the host: what the next reader needs is in a file here or in git.

```text
task.md        what to do: goal, requirements, constraints, acceptance criteria   host or analyze-task
status.md      where it stands: status, attention, pr, plan; risks at the end    every skill, as its last write
analysis.md    what the repo and the problem turned out to be                    analyze-task
spec.md        feature spec                                                       to-spec
issues/        NN-<slug>.md tickets                                               to-tickets, implement
review.md      reviewer findings and the checks read, against one commit         two-axis-review
pr.md          pull request rounds                                                babysit-pr
to-testing/    <run-id>/report.md and its recordings                              to-testing
logs/          sessions/, usage.json, <skill>-<id>/ evidence                      pi, fleet down, any skill
```

Above `logs/`: one short file per name, in the shape below or in the template beside its skill. Anything with many versions, big or binary lives in `logs/<skill>-<id>/` and is linked from the file that cites it.

## task.md

```md
# <title>

Source: <ticket URL | the user's prompt | none>
Branch: <branch>

## Goal
<one paragraph>

## Requirements
- <requirement>

## Constraints
- <constraint, or none>

## Acceptance criteria
- [ ] <criterion a command or a person can check>
```

## status.md

```md
status: new | analyzing | implementing | reviewing | testing | ready-for-host | pr-open | blocked | done
attention: none | <one sentence naming what a person has to decide or provide>
pr: none | #<n> <URL>

## Plan
- [x] <step>
- [ ] <step>

## Risks
- <what was not verified, or none>

## Uncommitted
- none | <file>, <reason>
```

The first unchecked step is the current work. `attention` is the line a person reads; `blocked` comes with an `attention` sentence. The commit lives in git: `fleet ls` and `git log` on the branch read it. `## Risks` and `## Uncommitted` appear at `ready-for-host` and `blocked`; the verification behind them is `review.md` and the logs it cites.
