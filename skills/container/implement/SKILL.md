---
name: implement
description: 'Building a ticket, spec or analysis into working code, one ticket at a time in the same session. Use when the user hands one to implement or asks for the next ticket of a feature.'
---

# Implement

Implement the work described in the task directory (`$FLEET_ARTIFACTS/$SANDBOX_NAME`, layout in `refs/artifacts.md` beside `AGENTS.md`) or in the ticket the user passed.

## Process

1. **Fetch the work.** A ticket path from the user: read it. Otherwise work the **frontier** of `issues/` in the task directory (outside fleet: `.issues/<feature-slug>/`): the lowest-numbered ticket whose `Status:` is `ready-for-agent` and whose "Blocked by" tickets are all `done`. No tickets: the short run `analysis.md` named is the work, one seam and one commit.

2. **Claim it.** Set `Status: claimed` in the ticket file and save before any work.

3. **Load context.** `analysis.md` from the task directory, the parent spec (`spec.md` beside `issues/`) if it exists, plus `CONTEXT.md` and any ADRs touching the area.

4. **Name the gate.** Before the first edit, state the command that will prove this ticket done and the one-line reason it is the right command. The ticket's acceptance criteria are the source; if they are not checkable by a command, say so and say what you will observe instead. This is the check step 9 re-runs, so name it now, not later.

5. **Build at the pre-agreed seams.** Read skill `tdd` before the first test and run its loop: one seam, one red, one implementation.

6. Run typechecking regularly and single test files regularly. The full suite belongs to step 9, not here.

7. **Resolve the ticket.** Tick the acceptance criteria you satisfied and set `Status: done`. A changed shared decision or accepted scope updates `spec.md`; slice-only findings go under a `## Comments` heading at the bottom of the ticket file.

8. **Commit** your work to the current branch.

9. **Close the gate.** Run the `two-axis-review` skill against the commit you just made, then re-run the step 4 check against `HEAD`. Anything the review changes means a new commit and another run of the check: a review that ran before the final commit proves the previous commit, not this one. Gate output goes to `logs/gate-<timestamp>/` in the task directory. Report the command, its exit code, and name anything you did not run and why. When another ticket remains, start it at step 1 in this same session.
