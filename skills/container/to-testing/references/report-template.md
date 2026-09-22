# Acceptance audit

Status: ready-for-human-approval | failed | blocked
Commit: <sha7> on <branch>, base <base-branch>@<sha7>, working tree <clean | status and diff hash>
Launch: `<command>` from `<working directory>`, answered at <URL> with <observed build marker>
Source: <ticket, spec, conversation or diff the criteria came from>
Runbook: <files edited and why, or none>

## Criterion matrix

| Criterion | Axis | Verdict | Evidence |
| --- | --- | --- | --- |
| <criterion> | acceptance / regression (<seam>) / risk | <verdict> | <screenshot, video chapter or test result> |

## Failures

Grouped by the seam they trace to. Omitted when every criterion passed.

### <seam>

1. <Criterion. Expected, actual, evidence. For a regression: the same flow on the base checkout and what it did there.>

## Coverage gaps

<Regression criteria this run could not prove, and what closing each one would take. Or none.>

## Incidental findings

<What the walk hit outside every criterion, with the route and the evidence. Or none.>

## Artifacts

| File | Criterion | Shows |
| --- | --- | --- |
| [<file>](<file>) | <criterion from the matrix> | <what to look at; for a video, what happens in order> |

Cleanup: browser closed, application stopped, working tree <clean | what was removed>.
