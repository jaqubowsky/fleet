---
name: implement
description: 'Building a ticket, spec or analysis into working code, one ticket at a time. Use when the user hands one to implement or asks for the next ticket of a feature.'
---

# Implement

Implement the ticket, spec or analysis you were handed.

## Process

1. **Fetch the work.** A ticket path from the user: read it. Otherwise work the **frontier** of the tickets where your seat's rules keep them, else `.issues/<feature-slug>/`: the lowest-numbered ticket whose `Status:` is `ready-for-agent` and whose "Blocked by" tickets are all `done`. No tickets: the short run the analysis named is the work.

2. **Load context.** The shared spec beside the tickets if it exists; the analysis for what the ticket leaves open.

3. **Name the goal, the boundaries and the gate.** Before changing the ticket or code, print the three lines your rules require:

   ```text
   Goal: <what this ticket makes work>
   Boundaries: <what stays untouched>
   Done-check: <the command that proves this ticket done>, <why it is the right command>
   ```

   The ticket's acceptance criteria are the source of the done-check; if they are not checkable by a command, say so and say what you will observe instead. The done-check covers what this diff touches: the tests of the changed files and of the files importing them, typecheck, lint. This is the check step 7 runs, so name it now, not later.

   Then name the acceptance line most likely to be false and make the check that would catch it the first red of step 5: a suite that only passes is not evidence.

4. **Claim it.** Set `Status: claimed` in the ticket file and save before implementation.

5. **Build at the seams the ticket names, else existing public ones.** A failing test first: one seam, one red, one implementation.

   Commit the first coherent vertical piece before widening. A ticket that still holds a second behaviour once the first works end to end was cut too wide:
   - the first behaviour takes steps 7-10 as this ticket
   - the rest, with its acceptance lines, becomes the next ticket, blocked by this one

   In a short run, or on an order naming this one ticket, the rest stays in this ticket.

6. Run typechecking regularly and single test files regularly.

7. **Run the gate.** Run the step 3 check once on the finished tree and keep its output as a log. The whole task's final checks belong to your seat's Finish, not to this ticket.

8. **Review by blast radius.** When the repository keeps a checklist for a change (red flags, a definition of done), go through it on the diff first. Then decide on the review. An independent review runs on the uncommitted diff, with the step 7 logs and the step 5 red logs as its checks, when the diff touches any of these:
   - a shared seam other code calls
   - persisted data or its schema
   - security, credentials or permissions
   - process control, CI or the build
   - an external or role-prompt contract
   - a failure that is expensive or hard to see

   Only a diff that touches none of them takes the gate as its check. An order for a review runs it whatever the diff. Record the decision, run or skipped, with a reason that names only what this diff can break, or why it cannot. A review's findings close as the review says.

9. **Commit** the work, with the review's fixes when one ran, to the current branch.

10. **Resolve the ticket.**
    - Tick each acceptance criterion beside its evidence: the test that proves it, or the log path and line that shows it. A criterion nothing here proved stays unticked, with the reason. A criterion about what a user sees is ticked only after checking the running app on the final visible change and opening its frame
    - Set `Status: done`
    - Slice-only findings go under a `## Comments` heading at the bottom of the ticket file; a changed shared decision or accepted scope updates the spec
    - Report the command, its exit code, and name anything you did not run and why
