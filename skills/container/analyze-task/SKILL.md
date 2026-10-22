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

The reply is the report: the three sections below, in this order, one screen in all. A written copy of the report opens with `Commit: <sha7>` of the HEAD analyzed and keeps the same three sections, whatever the size of the task.

Before the report, write the `Acceptance criteria` section at the end of the ticket in the ticket template's form: concrete values, boundary cases, the adjacent behaviour that must stay. Criteria already there are the starting point; keep them and add what the sources require. Every criterion is one the Plan closes.

### Findings

#### Verdict

At most three sentences: what the task turns out to be, and whether the ticket's scope holds. For a bug: the symptom the user sees, the cause, the reproduction command and its result. Name the cause, not the layer where you happened to notice it.

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

What will be built, one line per decision, each with the source or the user's answer that settled it, and the date of that answer. A product decision no source settles is not written here: it is an open question below.

### Plan

A numbered list of slices in implementation order, each one commit: what it delivers, the acceptance criteria it closes, and its test seam. A small change has one slice. Every criterion is closed by some slice.

```md
1. Restore brings back only the files deleted with the project. Closes criteria 1, 2. Seam: `restoreProject` service test
2. The trash list shows the restored count. Closes criterion 3. Seam: trash page component test
```

The reply ends with the open questions as a list, outside the three sections; the written copy leaves them out. List only unresolved decisions, with an unapproved Plan last. Cite the approving user decision for an accepted Plan. With none open, state the approved next step.

```md
1. <decision>
   - <option> (recommended). Downside: <one>
   - <option>. Downside: <one>
2. The Plan above
   - as listed (recommended). Downside: <one>
   - <another cut>. Downside: <one>
```

Rules for the report:

- Cite inside the Evidence column: `path:line`, issue ID, commit. Never a separate section listing what you read.
- No sentence about your own process. Not "I read", not "this changes my earlier conclusion". State the conclusion that holds now.
- A finding that needs a paragraph is two findings, or it belongs in Out of scope.
- At most one small ASCII diagram, and only when the flow has three or more hops and the labels carry the meaning.
- Detail beyond these slots goes to the ticket's criteria or to Decisions.

## Rationalizations

Each row quotes a run that went wrong: the first without this document in context, the second with it.

| Excuse | Reality |
| --- | --- |
| "The linked issue is a separate bug, a separate ticket." | Reachability during use of the changed flow decides scope, not which ticket first named the defect. A feature that reads through a path inherits that path's bug. |
| "The analysis is in the file", followed by one paragraph of prose | The reply is the report, in its slots. The file is the copy the next session reads; the person reads the chat. |
