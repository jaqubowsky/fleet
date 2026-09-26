---
name: implement
description: 'Building a ticket, spec or analysis into working code, one ticket at a time. Use when the user hands one to implement or asks for the next ticket of a feature.'
---

# Implement

Implement the work described in the task directory (`$FLEET_ARTIFACTS/$SANDBOX_NAME`, layout in {{refs}}) or in the ticket the user passed.

## Process

1. **Fetch the work.** A ticket path from the user: read it. Otherwise work the **frontier** of `issues/` in the task directory (outside fleet: `.issues/<feature-slug>/`): the lowest-numbered ticket whose `Status:` is `ready-for-agent` and whose "Blocked by" tickets are all `done`. No tickets: the short run `analysis.md` named is the work, one seam and one commit.

2. **Claim it.** Set `Status: claimed` in the ticket file and save before any work.

3. **Load context.** `analysis.md` from the task directory, the parent spec (`spec.md` beside `issues/`) if it exists, plus `CONTEXT.md` and any ADRs touching the area.

4. **Name the goal, the boundaries and the gate.** Before the first edit, print these three lines:

   ```text
   Goal: <what this ticket makes work>
   Boundaries: <what stays untouched>
   Done-check: <the command that proves this ticket done>, <why it is the right command>
   ```

   The ticket's acceptance criteria are the source of the done-check; if they are not checkable by a command, say so and say what you will observe instead. This is the check step 7 runs, so name it now, not later.

5. **Build at the pre-agreed seams.** Read skill `tdd` before the first test and run its loop: one seam, one red, one implementation.

6. Run typechecking regularly and single test files regularly. The full suite belongs to step 7, not here.

7. **Run the gate.** Run the step 4 check once on the finished tree. Gate output goes to `logs/gate-<local time, date +%Y%m%dT%H%M%S>/` in the task directory.

8. **Review by blast radius.** When the repository keeps a checklist for a change (red flags, a definition of done), go through it on the diff first. Then decide on the review: the `two-axis-review` skill runs on the uncommitted diff, with the step 7 logs as its checks, when the diff reaches past its own feature: a shared seam other code calls, persisted data or its schema, security, credentials or permissions, process control, CI or the build, an external or role-prompt contract, or a failure that is expensive or hard to see. Any other diff takes the gate as its check. Write the decision as one Log line in `status.md`, run or skipped with the reason; an order for a review runs it whatever the diff. A review's findings close as its step 5 says.

9. **Commit** the work, with the review's fixes when one ran, to the current branch.

10. **Resolve the ticket.** Tick each acceptance criterion beside its evidence: the test that proves it, or the log path and line that shows it. A criterion nothing here proved stays unticked, with the reason. Set `Status: done`. Run `ticket-check <ticket file>`; every line it prints goes into Summary as missing verification. A changed shared decision or accepted scope updates `spec.md`; slice-only findings go under a `## Comments` heading at the bottom of the ticket file. Report the command, its exit code, and name anything you did not run and why. In a task directory the commit is a natural break: suggest a session handoff as the container rule says. When another ticket remains, it starts at step 1 in whichever session takes it.
