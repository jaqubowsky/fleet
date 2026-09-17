---
name: to-testing
description: 'Browser acceptance audit of a finished change. Use after implementation and review when the changed behavior is reachable through a web UI. Produces a report with evidence and stops at ready-for-human-approval.'
---

# To testing

Audit finished user-facing behavior through the browser. This skill verifies; it never implements or repairs. It covers the browser layer of acceptance, beside the code, API, process and side-effect checks the caller runs.

A change with no web UI returns `not-applicable`.

## Process

1. Recover the acceptance source: the conversation, the ticket or spec, existing tests, the diff. Build the criterion matrix from [the audit procedure](references/audit.md).
2. Read the project runbook in `$FLEET_ARTIFACTS/runbook/`. No runbook: work from the repository's own files and keep notes of every command, route and workaround as you go; the runbook is written at step 5, from what actually worked.
3. Start the application in this container, prove the checkout, claim an `agent-browser` session, walk every criterion, then the diff-derived risk states.
4. A failed or `not-implemented` criterion stops the audit: clean up, show criterion, expected, actual, evidence. No passing report is written.
5. All criteria pass: clean up, then maintain the runbook from this run's notes as [the audit procedure](references/audit.md) describes: only commands and routes that worked, only workarounds that were needed, and delete what this run contradicted.
6. Write `$FLEET_ARTIFACTS/$SANDBOX_NAME/to-testing/<run-id>/report.md` from [the report template](references/report-template.md), naming the runbook files touched, print it in full, end with `ready-for-human-approval`. Every path you print, in the report and in chat, is expanded to its absolute value, so the person can click it.

Done means: every criterion in the matrix has a verdict backed by evidence from this checkout, the application and browser are stopped, and the runbook reflects what the audit learned.
