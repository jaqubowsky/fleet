---
name: implement
description: 'Implement a piece of work described by a local spec or ticket file under .issues/. Use when the user asks to implement a spec, a ticket, or the next ticket of a feature.'
---

# Implement

Implement the work described by the user in the spec or tickets.

## Process

1. **Fetch the work.** If the user passed a ticket path, read it. If they passed a feature slug or spec, work the **frontier** of `.issues/<feature-slug>/`: the lowest-numbered ticket whose `Status:` is `ready-for-agent` and whose "Blocked by" tickets are all `done`.

2. **Claim it.** Set `Status: claimed` in the ticket file and save before any work.

3. **Load context.** Read the parent spec (`.issues/<feature-slug>/spec.md`) if it exists, plus `CONTEXT.md` and any ADRs touching the area.

4. **Name the gate.** Before the first edit, state the command that will prove this ticket done and the one-line reason it is the right command. The ticket's acceptance criteria are the source; if they are not checkable by a command, say so and say what you will observe instead. This is the check step 9 re-runs, so name it now, not later.

5. **Build with TDD** at the pre-agreed seams, using the `tdd` skill.

6. Run typechecking regularly and single test files regularly. The full suite belongs to step 9, not here.

7. **Resolve the ticket.** Tick the acceptance criteria you satisfied, set `Status: done`, and append anything surprising (decisions made, scope adjusted) under a `## Comments` heading at the bottom of the ticket file.

8. **Commit** your work to the current branch.

9. **Close the gate.** Run the `two-axis-review` skill against the commit you just made, then re-run the step 4 check against `HEAD`. Anything the review changes means a new commit and another run of the check: a review that ran before the final commit proves the previous commit, not this one. Report the command, its exit code, and name anything you did not run and why.

One ticket per context window: clear context between tickets and let the ticket files carry the state.
