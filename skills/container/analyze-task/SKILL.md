---
name: analyze-task
description: 'Turning a ticket, bug report or feature request into an evidence-backed analysis before any code is written. Use when the user asks what a piece of work involves, what is really broken, or how big it is.'
---

# Analyze task

This workflow ends at a proposal and the ticket's acceptance criteria; implementation and the work itself start on a separate request. Reproduction tests, harnesses and reversible probes are allowed within existing permissions. Keep diagnostic artifacts identifiable, remove temporary instrumentation before handover, report anything retained. Pass this boundary to every delegated agent.

## Read the sources before reading the code

Requirements are not in the ticket title. Read each source below that can change this task's scope or behavior, and name the ones you could not open.

In the tracker (Linear or equivalent):

- the description, then every comment, with author and date
- attachments: screenshots, recordings, files
- every linked issue, followed one level deep: parent, sub-issues, blocks and blocked by, relates to, duplicates. Read their descriptions and comments. Stop descending when a link stops touching the analyzed flow.
- outbound links: Figma, Notion, Slack threads, specification documents, pull requests. List them and say which ones you could open.

In the repository, for the area being changed:

- README at the root and at the module
- CLAUDE.md, AGENTS.md, CONTRIBUTING.md
- `docs/`, in particular `docs/adr/`
- comments and docstrings in the touched files, plus `git log -p` on them where the code looks deliberately odd

Cite every source that changed a conclusion: issue URL, or `path:line`.

User amendments define the current scope. A recommendation in a comment does not. A recorded ADR is overturned deliberately and in writing, never by silence. Where a source contradicts the code, quote both and say which wins: the code and the accepted user scope take precedence.

When the sources leave unclear what the task asks, or the one that would settle it does not open, end the turn on that open question before you investigate. Any other source that does not open is named, and the conclusions it could change are labeled provisional.

## Choose the investigation path

Choose from the described behavior, not from the issue label or title. State the chosen path.

| Described behavior | Path |
| --- | --- |
| New behavior or capability | one `explorer` run traces the existing behaviour from its entry point: callers, data flow, the user-visible outcome, and where the gap is |
| Broken, slow, visually incorrect or regressed | Diagnose it: a feedback loop, a reproduction, hypotheses, instrumentation |
| Both in one request | Diagnose the defect first, then the `explorer` trace for the new behavior; keep causes, fixes and additions distinguishable |

Stop before the fix. Present the reproduced symptom, the reproduction command and its result, the supported cause, and the proposed fix with its verification. Blocked reproduction is an incomplete diagnosis, never a fix. Static code reading alone is not a confirmed diagnosis.

## Trace the current behavior

Bind each criterion's target, in the form of {{refs.ticket}}, to the original request and its user amendments. A derived ticket's target is a claim to check against those sources. Carry the source and target beside the criterion into the ticket.

Follow that mounted entry point through selection and state, validation, API, backend effects, and the user-visible outcome. Check callers, feature flags, permissions and alternative paths. Separate active code from unmounted or legacy code. Cover success, failure, cancellation, retry, empty selection and partial validity where relevant. Read the existing tests.

Whole flow means every reachable branch from trigger to outcome, not every file in the repository. Stop when those branches are accounted for and each requirement has supporting evidence or an explicit gap. Record what the code proves, what you executed, and what stays unverified.

## Bound the changes

Classify by relationship to the task, not by literal mention in the specification.

| Classification | Treatment |
| --- | --- |
| Required behavior missing, or a supporting dependency | In scope, with requirement and dependency evidence, backend changes included |
| Defect affecting use of the changed flow | In scope, with reachable scenario, user impact and acceptance check, even if pre-existing or absent from the ticket |
| Improvement to code being touched | Propose alongside required work with concrete benefit, bounded change, cost and regression risk; keep it distinct from a delivery requirement |
| Existing behavior already works | Reuse and preserve |
| Finding outside the affected flow, or a broad redesign | Report for awareness, keep out of implementation steps and acceptance gates |
| Suspected defect or uncertain dependency | Investigate; if unresolved, name the evidence gap and the check needed |

For a defect, trace how a user reaches it while using the feature and what fails. Include failures in cancellation, retry, partial success, error visibility and recovery when the evidence connects them to that use.

Example: continuation reaches a server error dialog that hides rejected document IDs and blocks removal and retry. Fixing recovery is in scope even though the ticket names only the continuation button. Computing remaining IDs once in the touched handler is a local improvement to propose. Reworking validation in an unmounted admin screen stays out.

## Present

The written copy is the report: `Commit: <sha7>` of the HEAD analyzed, then the three sections below, in this order, whatever the size of the task. The reply is short: the Verdict, the absolute path of the report's page, then the open questions.

Before the report, write the `Acceptance criteria` section at the end of the ticket in the ticket template's form: concrete values, boundary cases, the adjacent behaviour that must stay. Criteria already there are the starting point; keep them and add what the sources require. Every criterion is one the Plan closes.

### Findings

#### Verdict

At most three sentences: what the task turns out to be, and whether the ticket's scope holds. One more sentence says what the reader decides: the open questions, or the Plan. For a bug: the symptom the user sees, the cause, the reproduction command and its result. Name the cause, not the layer where you happened to notice it.

#### Where it lands

The place the change lands, a route, endpoint, job, command or function, marked as chosen, then every other place that matches the request's words, one line each with what tells it apart.

```md
- `/projects/:id/trash` restore button (chosen): the request names deleted projects
- `/admin/projects` restore action: also restores, admins only
```

#### What this rests on

One row per finding that changed a decision. Cells are phrases, not sentences. A source that only confirmed a conclusion you already held is not a finding.

| Finding | Evidence | Consequence |
| --- | --- | --- |
| The sync flag is off on purpose | review on PR #398, commit `1114463` | turn it on in the change that ships delivery |

#### Out of scope

One line per item, with the reason.

#### Open and unverified

Open questions with the decision each one blocks. Sources you could not open. Checks proposed but not run. One line each.

### Decisions

`Settled`: what will be built, one line per decision, each with the source or the user's answer that settled it, and the date of that answer. A product decision no source settles is not written here: it is an open question below.

`Technical choices`: what you chose or assumed by default, one block each, written for a reader who has not met the mechanism.

```md
- Lock the project while it restores
  Problem: the cleanup job deletes projects after 30 days. Run at the same moment, it and the restore both read "deleted", so the owner gets a project with no files.
  How it works: `SELECT ... FOR UPDATE` holds the project's row until the transaction ends. The job waits, then sees an active project and skips it.
  Turned down: a `restoring` flag, which a crash leaves set for good.
  Worth remembering: this is a check-then-act race. A lock makes the second reader wait for the first write.
```

### Plan

With a decision open, this section holds one line: waiting on the open questions. With none open, the Plan is the last thing the analysis writes.

A numbered list of slices in implementation order, each one commit: what it delivers, the acceptance criteria it closes, and its test seam, plus what it changes and the slices it waits for. Group by the behaviour a user sees, in full sentences, naming a file only where the behaviour leaves it unclear. A small change has one slice. Every criterion is closed by some slice.

```md
1. Restoring a project with its files
   Delivers: the owner gets the project back with the files deleted with it. Files deleted earlier stay in the trash.
   Changes: `~ restoreProject`, `~ files.deleted_batch_id`.
   Closes criteria 1 and 2, proved by a `restoreProject` service test. Waits for nothing.
2. The restored count on the trash list
   Delivers: after a restore the list says how many files came back.
   Changes: `+ restoredFiles`, `~ TrashPage`.
   Closes criterion 3, proved by a trash page component test. Waits for slice 1.
```

Under the list, `How it connects`: numbered steps in the order they run, from the trigger to the outcome, one sentence each, for a mid-level developer of this repository.

```md
1. The restore button on `TrashPage` calls `POST /projects/:id/restore`.
2. The endpoint calls `restoreProject`, which opens one transaction.
3. The transaction clears `deleted_at` on the project and on the files of its `deleted_batch_id`, so a failure brings nothing back.
```

Under it, `What changes`: one line per changed thing, grouped by kind, marked `+` new, `~` changed or `-` removed. A kind is what the change touches, such as database, API, config, job or screen. A database line gives the table, column and type, and an index names the query it serves. The database kind opens with what the migration does to existing rows and whether it reverts. A screen is listed when a mockup exists, by its slug.

```md
Database: adds an index, existing rows stay, reverts.
- `~ files.deleted_batch_id` uuid, new index: the restore finds a batch's files by it
API
- `+ restoredFiles` in the 200 of `POST /projects/:id/restore`
```

The reply ends with the open questions as a list, outside the three sections; the written copy leaves them out. List only unresolved decisions; with none left, the unapproved Plan is the one question. For an accepted Plan, cite its approval and state the approved next step.

```md
1. <decision>
   Checked: <the sources read, and why they leave this open>
   - <option> (recommended). Downside: <one>
   - <option>. Downside: <one>
```

```md
1. The Plan above
   - as listed (recommended). Downside: <one>
   - <another cut>. Downside: <one>
```

Rules for the report:

- Cite inside the Evidence column: `path:line`, issue ID, commit. Never a separate section listing what you read.
- No sentence about your own process. Not "I read", not "this changes my earlier conclusion". State the conclusion that holds now.
- A finding that needs a paragraph is two findings, or it belongs in Out of scope.
- Detail beyond these slots goes to the ticket's criteria or to Decisions.

## Rationalizations

Each row quotes a run that went wrong: the first without this document in context, the second with it.

| Excuse | Reality |
| --- | --- |
| "The linked issue is a separate bug, a separate ticket." | Reachability during use of the changed flow decides scope, not which ticket first named the defect. A feature that reads through a path inherits that path's bug. |
| "The analysis is in the file", followed by one paragraph of prose | The reply fills its slots: the Verdict, the page's path, the open questions. One paragraph of prose fills none of them. |
