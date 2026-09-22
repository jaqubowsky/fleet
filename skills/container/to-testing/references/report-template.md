# Acceptance audit

Status: ready-for-human-approval / failed / blocked
Folder: [<artifact-dir>](file://<artifact-dir>) — every artifact named below is in it.
Run ID: <run-id>
Branch: <branch>
Commit: <commit>
Base: <base-branch> at <merge-base commit>
Working tree: <clean, or status and diff hash>
URL: <tested-url>

## Acceptance source

<Conversation, ticket, spec, tests and diff the acceptance criteria came from.>

## Blast radius

| Seam the diff modifies | Siblings | Regression criteria |
| --- | --- | --- |
| <function, module, route, schema, component> | <behaviors passing through it, or "none"> | <criteria raised, or why none is needed> |

## Checkout proof

- Launch: `<command>` from `<working directory>`
- Response: `<URL and the observed build marker>`

## Criterion matrix

| Criterion | Axis | Verdict | Evidence |
| --- | --- | --- | --- |
| <criterion> | acceptance / regression | <verdict> | <step, test result or diff evidence> |

## Failures

Grouped by the seam they trace to. Omit when every criterion passed.

### <seam>

1. <Criterion. Expected, actual, evidence. For a regression: the same flow on the base checkout and what it did there.>

## Coverage gaps

<Regression criteria this run could not prove, and what closing each one would take. Or "none".>

## Incidental findings

<What the walk hit outside every criterion, with the route and the evidence. Or "none".>

## Browser walkthrough

1. <Action, route, observed result.>

## Risk states

1. <Diff-derived risk, action, observed result.>

## Artifacts

Trace: [trace.zip](trace.zip) — the whole walk.

| Artifact | Criterion | Shows | Capture | Viewport |
| --- | --- | --- | --- | --- |
| [<file>](<file>) | <one criterion from the matrix> | <what it shows and where to look; a video, what happens in order> | video, viewport, or full-page: <reason> | <w>x<h> |

None beyond the trace. The audit needed no further visual evidence.

## Runbook changes

<Runbook files edited during this audit and why, or "none".>

## Cleanup

Browser session: closed
Application processes: stopped
Working tree: <clean, or what was removed>
