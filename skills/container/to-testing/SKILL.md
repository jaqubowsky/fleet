---
name: to-testing
description: 'Browser acceptance audit of a finished change. Use after implementation and review when the changed behavior is reachable through a web UI.'
compatibility: Requires a container that can start the project's app, plus playwright-cli for the browser session
---

# To testing

Audit finished user-facing behavior through the browser on two axes: the change does what was asked, and its siblings still do what they did on the base branch. This skill verifies; it never implements or repairs. It covers the browser layer of acceptance, beside the code, API, process and side-effect checks the caller runs.

A change with no web UI returns `not-applicable`.

## Process

1. Recover the acceptance source: `task.md` and `status.md` in the task directory (`$FLEET_ARTIFACTS/$SANDBOX_NAME`, layout in `refs/artifacts.md`), the ticket or spec, existing tests, the diff against the base branch. Set `status: testing` there. Build the criterion matrix on both axes from [the audit procedure](references/audit.md).
2. Read the project runbook in `$FLEET_ARTIFACTS/runbook/`. No runbook: work from the repository's own files and keep notes of every command, route and workaround as you go; the runbook is written at step 5, from what actually worked.
3. Start the application in this container; one that does not start ends the run `blocked` on the named missing piece. Prove the checkout, claim a `playwright-cli` session, walk every acceptance criterion, then every regression criterion, then the diff-derived risk states.
4. A failing criterion is recorded with its evidence and the walk goes on; only a blocked audit stops where it stands. [The audit procedure](references/audit.md) separates the two, and a regression from a defect the branch inherited.
5. Clean up, then maintain the runbook from this run's notes as [the audit procedure](references/audit.md) describes: only commands and routes that worked, only workarounds that were needed, and delete what this run contradicted.
6. Write `$FLEET_ARTIFACTS/$SANDBOX_NAME/to-testing/<run-id>/report.md` from [the report template](references/report-template.md), naming the runbook files touched, print it in full, end with the run's status. Every path you print, in the report and in chat, is expanded to its absolute value, so the person can click it. In `status.md`, tick the testing step and set `status:` by the run's status: `ready-for-host` when it passed, `implementing` with each failed criterion as a new plan step when it failed, `blocked` with an `attention` line when it was blocked.

Done means: every criterion on both axes carries a verdict backed by evidence from this checkout, every seam the diff modifies is accounted for on the regression axis, the application and browser are stopped, and the runbook reflects what the audit learned.
