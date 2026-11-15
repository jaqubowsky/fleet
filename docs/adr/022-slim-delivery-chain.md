# Slim the delivery chain to one pass, one review and one walk

## Status

Accepted. Replaces the pattern list and the `added-comments` check of [014](014-simplicity-pass-before-the-checks.md), the analysis page of [019](019-plan-approved-before-the-code.md), and the loop of [016](016-babysit-after-pull-request.md) for a pull request from a one-slice Plan.

## Context

An audit of the container runs of 2026-11-08 to 2026-11-15 read 88 transcripts: 85 tasks with usage, $1658, a median task of $17 and 49 active minutes. The person asked for the fewest skills and rules that still get a ticket delivered. Per step, the runs showed:

| Step | What the runs showed |
| --- | --- |
| `analysis-page` | 87 runs, $59, 226 minutes. No container read the page, the host opened it twice and `analysis.md` 20 times, and the person said they do not use it |
| independent review | 161 reviewer runs for 86 tasks, 1.87 per task, although the checks table says one |
| reviewer's quality axis | of 151 findings in 86 tasks, 43 were duplicated knowledge, none named a unit with two roles and one named state. The host's second reviews of 15 tasks found 12 on roles and 6 on state |
| `simplicity-pass` | 115 blocks, 26 of them `none found` in every row, and the comments row empty 121 times of 126 |
| browser walks | 190 walks in 67 tasks, a median of 2. In 30 of 47 tasks the walk started before the review returned, so a review fix could make it stale |
| `check-regressions` | 48 runs, a real regression in 3 of 55 reports |
| `boy-scout-rule` | 155 blocks in 82 tasks, 4296 words added net, no edit in 27 tasks. One repository's `gotchas.md` grew from 3581 to 6087 words since 2026-10-22, and every task reads it before its first gate |
| guard refusals | the commit format 66 times in 60 of 88 tasks, `pkill -f` 52 times in 37 tasks |
| babysit | 125 and 84 minutes in two tasks, with rounds that changed nothing |

The added lines of those 86 tasks, about 69 thousand lines of TypeScript, held no `any`, no non-null assertion, no lint suppression, 25 casts and 3 comment lines. The mechanical defects that studies of generated code report are nearly absent here. What reached the host's reviews was structure: roles, the place of code, state, and knowledge written twice across layers.

## Decision

The chain of a delivery is: analysis, the Plan's approval, the slices, the simplicity pass, the branch update, one review with typecheck and lint alongside it, the review fixes, one walk of the running app, the pull request.

- Skill `analysis-page` and its template are removed. The person and the host read `analysis.md`.
- One review per run. The rule that reviewed every unreviewed commit before the branch left the container is removed; a later round that changes what the code decides still gets its own review. A further review on the host runs on the user's word.
- `simplicity-pass` runs its tools first, then four reads: a guard or fallback for a case nothing reaches, dead code, a rule written twice, code unlike the rest of its file. `touched-comments` replaces `added-comments` and has two modes. `--added` prints the comment lines the branch adds. `--all` prints every comment line in every file the branch touches, for a repository that keeps no comments. Neither prints a line a tool reads or a license header. The mode is what `## Comments` in the project overlay says, and `--added` where the section is missing, so a repository shared with other people keeps their comments until its overlay says otherwise.
- The reviewer's quality axis asks five questions, in `quality.md` beside `two-axis-review`, in place of the twelve Fowler smells and the four questions the skill carried: the role of each unit, each rule written once, the place of a computation and a type, state without redundancy or contradiction, and what the repository already has.
- `check-feature` also walks the neighbours of each seam the diff modifies, and the base checkout is built only for a neighbour that failed. Skill `check-regressions` is removed. The walk starts once the review's fixes are committed.
- `boy-scout-rule` runs in a turn that a project note misled, or that lost a rerun to a fact no note held. A screen's traps go into that screen's `features/<screen>.md`, which only a task driving the screen reads.
- The container rules state the commit format and how to stop a started process.
- A task that comes out as one slice modifying no seam another caller uses writes a short analysis, and a pull request whose Plan has one slice gets one babysit round.

Left out on purpose: a router skill with playbooks, a separate simplifier sub-agent, and a structural review as a step of its own. The pass has no point on `any` or casts, since the runs hold almost none.

## Consequences

The same counts on later tickets show whether this worked: reviewer runs per task, walks per task, the reviewer's findings on roles and state, the words in `gotchas.md`, and the cost of the smallest quarter of tasks, $7 today. No container has run on these rules yet.

A regression in a neighbour of a one-slice task is caught by the review or by tests that import the changed file, since such a task has no neighbour to walk. After the one babysit round of a small pull request nobody in the container waits for CI, so the host or the person reads the checks. Clearing every comment needs a `## Comments` section in each overlay that wants it. The question about a unit's role is a heuristic with no measured method behind it.

The audit named `fleet usage` as filing 46% of the cost under `direct` because of task notifications. That was wrong: `src/fleet/usage.ts` already ignores them. In the one transcript checked, the cost lands in `direct` after a person's steer, which a test of that file states as intended. The file is unchanged.
