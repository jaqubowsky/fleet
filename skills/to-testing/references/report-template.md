# Acceptance audit

Status: ready-for-human-approval
Run ID: <run-id>
Branch: <branch>
Commit: <commit>
Working tree: <clean, or status and diff hash>
URL: <tested-url>

## Acceptance source

<Conversation, ticket, spec, tests and diff the criteria came from.>

## Checkout proof

- Launch: `<command>` from `<working directory>`
- Response: `<URL and the observed build marker>`

## Criterion matrix

| Criterion | Verdict | Evidence |
| --- | --- | --- |
| <criterion> | <checked-in-browser / covered-by-existing-test / out-of-scope-with-evidence> | <step, test result or diff evidence> |

## Browser walkthrough

1. <Action, route, observed result.>

## Risk states

1. <Diff-derived risk, action, observed result.>

## Artifacts

| Artifact | Criterion | Capture | Viewport |
| --- | --- | --- | --- |
| [<file>](<file>) | <one criterion from the matrix> | viewport, or full-page: <reason> | <w>x<h> |

None. The audit needed no visual evidence.

## Runbook changes

<Files under .pi/runbook/ edited during this audit and why, or "none".>

## Cleanup

Browser session: closed
Application processes: stopped
