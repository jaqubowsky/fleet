---
name: deliver-ticket
description: 'Delivering a ticket, a bug report or a feature from its first read to the final checks: analysis, slices, checks table, branch update. Use when an order says to deliver one, or the first line of a ticket names this skill.'
---

# Deliver a ticket

Every output goes in the task directory. Every step reads `CONTEXT.md`, when the repository has one, for the domain vocabulary that names in tests and code follow, and the ADRs touching the area, which bind it. An ADR the run's decisions need is proposed in its pull request, as a commit adding it under `docs/adr/`.

## 1. Analyze

`analyze-task` writes the `Acceptance criteria` section of `ticket.md`, in the form of {{refs.ticket}}, starting from any criteria the host copied there, and `analysis.md` with its three sections: Findings, Decisions, Plan. A defect is diagnosed there with `diagnosing-bugs`, before the fix. It ends with every decision still open as the closing message's open questions. An order to deliver end to end answers all but a product decision nothing settled

## 2. Implement the slices

The Plan's slices in order: a failing test first with `tdd`, gate output in `logs/gate-<date +%Y%m%dT%H%M%S>/`.

1. **Fetch the work.** The ticket and its analysis from step 1. The work is the Plan's slices, in order; the slice in hand is the first one without its commit.

2. **Load context.** The ticket's acceptance criteria, and the analysis's Findings and Decisions for what the criteria leave open.

3. **Name the goal, the boundaries and the gate.** Before changing the ticket or code, print the three lines your rules require, the done-check with why it is the right command.

   The acceptance criteria the slice closes are the source of the done-check; if they are not checkable by a command, say so and say what you will observe instead. Each commit is green on its own: the done-check covers the tests of the changed files and every test that imports them, anywhere in the repository. A file inside a workspace package is also imported through the package's name: rebuild the package when its `main` points at build output, then run every test that imports that name, in every workspace. Typecheck and lint cover the whole branch diff, so they run once, alongside the review. This is the check step 5 runs, so name it now, not later.

   Then name the acceptance line most likely to be false and make the check that would catch it the first red of step 4: a suite that only passes is not evidence.

4. **Build at the seam the slice names, else existing public ones.** A failing test first: one seam, one red, one implementation.

   Commit the first coherent vertical piece before widening. A slice that still holds a second behaviour once the first works end to end was cut too wide: split it in the Plan, and the rest becomes the next slice.

5. **Run the gate.** Run the step 3 check once on the finished tree and keep its output as a log. The whole task's final checks belong to "Branch update and final checks" below, not to this slice.

6. **Check the diff against the repository's checklist.** When the repository keeps one for a change (red flags, a definition of done), go through it on the diff. The independent review runs once, over the whole branch, as the Checks table orders it.

7. **Commit** the slice to the current branch, its changed files run through the repository's formatter first so formatting never needs a commit of its own, then take the next slice from step 3.

8. **Resolve the ticket**, after the final checks of "Branch update and final checks".
    - In one edit at the end of the ticket, tick each acceptance criterion beside its evidence: the test that proves it, or the log path and line that shows it. A criterion nothing here proved stays unticked, with the reason. A criterion about what a user sees is ticked only after checking the running app on the final visible change and opening its frame
    - Findings outside the criteria go under a `## Comments` heading at the bottom of the ticket file; a changed decision or accepted scope updates the analysis's Decisions
    - Report the command, its exit code, and name anything you did not run and why

## 3. Checks

Each check runs once, where it is cheapest:

| Check | When | Times per task |
| --- | --- | --- |
| Red test | before the code of each behaviour | 1 per behaviour |
| Slice tests (changed files and every test that imports them, by path or by package name) | after the slice's code | 1 per slice, plus reruns while fixing |
| Branch update, by the method `## Merge method` in `project.md` names | after the last slice's commit | 1, never repeated by a later session |
| Independent review of the whole branch, `two-axis-review` | after the branch update | 1 |
| Typecheck and lint of changed files | alongside the review, with no app running | 1 |
| Tests of affected packages, when a slice changed a file no test imports, such as test setup, config or a global mock | alongside the review, with no app running; on the base only the files that failed | 1 |
| Review fixes | one batch, each with its own test | 1 |
| End-to-end suite, where the project has one | the changed path's specs after its slice; the full suite on the final tree | 1 per slice, plus 1 |
| Verification of what a user sees, with `check-feature` the way `project.md` names | last, on the final tree | 1 |

## 4. Branch update and final checks

1. The branch update: `git fetch origin` once, on a branch never pushed. `git merge-base --is-ancestor origin/<base> HEAD` exiting 0 means no update; otherwise update by the method `## Merge method` in `project.md` names, a merge where it names none. A conflict is resolved, never aborted. A fetch that cannot authenticate leaves the update to the host: name the base the branch sits on as an open question and ask for no credential
2. With `repositories.json`, finish and commit each repo separately and run its gate in its own workspace; an integration test report records every full HEAD SHA captured for that run, and a diff hash for each dirty working tree
3. The final checks of the table run on the updated tree, and their rows go into the closing message
