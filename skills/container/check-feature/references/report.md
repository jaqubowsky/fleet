# Browser check

Status: passed | failed | blocked
Commit: <single repo only: sha7 on branch, base branch@sha7, working tree clean | status and diff hash>
Repository set: <multiple repos only: every name from repositories.json@full SHA; branch, base SHA, dirty state and diff hash for each>
Launch: `<command>` from `<working directory>`, answered at <URL>
Source: <analysis, spec, tickets or diff the criteria came from>
Runbook: <files edited and why, or none>

## Criteria

| Criterion | Verdict | Evidence |
| --- | --- | --- |
| <criterion> | <verdict> | <screenshot, or test command and result> |

In a regression walk the table carries a fourth column, `Seam`, and the verdicts `regressed`, `pre-existing`, `coverage-gap`.

## Failures

Grouped by the seam they trace to. Omitted when every criterion passed.

### <seam>

1. <Criterion. Expected, actual, evidence. For a regression: the same flow on the base checkout and what it did there.>

## Incidental findings

<What the walk hit outside every criterion, with the route and the evidence. Or none.>

## Artifacts

Run directory: <absolute file:// link>

| File | Criterion | Shows |
| --- | --- | --- |
| [<file>](<file>) | <criterion> | <what to look at> |

Cleanup: browser closed, application stopped, working tree <clean | what was removed>.
