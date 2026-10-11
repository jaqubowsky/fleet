---
name: implement
description: 'Building the slices of an analysis Plan into working code, one commit per slice. Use when the user hands a ticket and its analysis to implement.'
---

# Implement

Implement the ticket you were handed, slice by slice, as its analysis plans it.

## Process

1. **Fetch the work.** The ticket and its analysis. The work is the Plan's slices, in order; the slice in hand is the first one without its commit.

2. **Load context.** The ticket's acceptance criteria, and the analysis's Findings and Decisions for what the criteria leave open.

3. **Name the goal, the boundaries and the gate.** Before changing the ticket or code, print the three lines your rules require:

   ```text
   Goal: <what this slice makes work>
   Boundaries: <what stays untouched>
   Done-check: <the command that proves this slice done>, <why it is the right command>
   ```

   The acceptance criteria the slice closes are the source of the done-check; if they are not checkable by a command, say so and say what you will observe instead. The done-check covers what this diff touches: the tests of the changed files and of the files importing them. Typecheck and lint cover the whole branch diff, so they run once, in your seat's Finish. This is the check step 6 runs, so name it now, not later.

   Then name the acceptance line most likely to be false and make the check that would catch it the first red of step 5: a suite that only passes is not evidence.

4. **Write a changed requirement down first.** A requirement that changes while you build goes into the ticket's criteria, and a changed decision into the analysis's Decisions, before the code changes.

5. **Build at the seam the slice names, else existing public ones.** A failing test first: one seam, one red, one implementation.

   Commit the first coherent vertical piece before widening. A slice that still holds a second behaviour once the first works end to end was cut too wide: split it in the Plan, and the rest becomes the next slice.

6. **Run the gate.** Run the step 3 check once on the finished tree and keep its output as a log. The whole task's final checks belong to your seat's Finish, not to this slice.

7. **Check the diff against the repository's checklist.** When the repository keeps one for a change (red flags, a definition of done), go through it on the diff. The independent review runs once, over the whole branch, as your seat's Checks table orders it.

8. **Commit** the slice to the current branch, then take the next slice from step 3.

9. **Resolve the ticket**, after your seat's final checks.
    - In one edit at the end of the ticket, tick each acceptance criterion beside its evidence: the test that proves it, or the log path and line that shows it. A criterion nothing here proved stays unticked, with the reason. A criterion about what a user sees is ticked only after checking the running app on the final visible change and opening its frame
    - Findings outside the criteria go under a `## Comments` heading at the bottom of the ticket file; a changed decision or accepted scope updates the analysis's Decisions
    - Report the command, its exit code, and name anything you did not run and why
