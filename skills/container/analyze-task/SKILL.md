---
name: analyze-task
description: 'Turning a ticket, bug report or feature request into an evidence-backed analysis before any code is written. Use when the user asks what a piece of work involves, what is really broken, or how big it is.'
---

# Analyze task

## Overview

Produce an evidence-backed requirements analysis: the accepted specification, the evidenced defects that impair use of the same flow, and worthwhile improvements to the code being touched.

This workflow ends at a proposal; implementation, ticket updates and the work itself start on a separate request. Reproduction tests, harnesses and reversible probes are allowed within existing permissions. Keep diagnostic artifacts identifiable, remove temporary instrumentation before handover, report anything retained. Pass this boundary to every delegated agent.

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

If a source is unavailable, request its contents, continue independent code discovery, and label the conclusions provisional.

## Choose the investigation path

Choose from the described behavior, not from the issue label or title. State the chosen path.

| Described behavior | Path |
| --- | --- |
| New behavior or capability | one `explorer` run traces the existing behaviour from its entry point: callers, data flow, the user-visible outcome, and where the gap is |
| Broken, slow, visually incorrect or regressed | Diagnose it: a feedback loop, a reproduction, hypotheses, instrumentation |
| Both in one request | Diagnose the defect first, then the `explorer` trace for the new behavior; keep causes, fixes and additions distinguishable |

Stop before the fix. Present the reproduced symptom, the reproduction command and its result, the supported cause, and the proposed fix with its verification. Blocked reproduction is an incomplete diagnosis, never a fix. Static code reading alone is not a confirmed diagnosis.

If expected behavior is genuinely unclear, ask for it while gathering independent evidence. Do not guess a product requirement in order to classify a bug.

## Trace the current behavior

Bind each screen criterion to the original request and its user amendments: original source, mounted route, organization or role, operated control and expected transition. A derived ticket's route is a claim to check against those sources. If two mounted screens fit and the original sources do not distinguish them, ask which before mockup or implementation. Carry the source and target beside the criterion into the ticket.

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

After the code analysis, report missing knowledge or access honestly.

The reply is the report: the headings below, in this order, one screen in all.

A written copy of the report opens with `Commit: <sha7>` of the HEAD analyzed.

### Verdict

At most three sentences: what the task turns out to be, and whether the ticket's scope holds. For a bug: the symptom the user sees, the cause, the reproduction command and its result. Name the cause, not the layer where you happened to notice it.

### What this rests on

One row per finding that changed a decision. Cells are phrases, not sentences. A source that only confirmed a conclusion you already held is not a finding.

| Finding | Evidence | Consequence |
| --- | --- | --- |
| The SYNCHRONIZER gate is deliberate | review on PR #1910, commit `1114463` | open it in the change that ships delivery |

### Out of scope

One line per item, with the reason.

### Open and unverified

Open questions with the decision each one blocks. Sources you could not open. Checks proposed but not run. One line each.

### The run and the one question

The run this analysis calls for, in one line with the reason: tickets, or the short run when the work is one accepted behaviour, one seam and one commit. Under it, the proposed split into tickets and the test seams, one line each. Cite the approving user decision for an accepted run, split or seam. Ask one question containing only unresolved decisions, with an unapproved run, split and seams last. If none remain, state the approved next step.

```md
1. <decision>
   - <option> (recommended). Downside: <one>
   - <option>. Downside: <one>
2. The run, the split and the test seams above
   - as listed (recommended). Downside: <one>
   - <another split>. Downside: <one>
```

Define a term before using it, and keep one name per concept across the whole report. State the mechanism instead of naming it; no framing labels ("the key insight", "at its core"), no metaphor standing in for the mechanism.

Rules for the report:

- Cite inside the Evidence column: `path:line`, issue ID, commit. Never a separate section listing what you read.
- No sentence about your own process. Not "I read", not "this changes my earlier conclusion". State the conclusion that holds now.
- A finding that needs a paragraph is two findings, or it belongs in Out of scope.
- At most one small ASCII diagram, and only when the flow has three or more hops and the labels carry the meaning.
- Detail beyond these slots goes to the ticket.

## Rationalizations

Each row quotes a run that went wrong: the first without this document in context, the second with it.

| Excuse | Reality |
| --- | --- |
| "The linked issue is a separate bug, a separate ticket." | Reachability during use of the changed flow decides scope, not which ticket first named the defect. A feature that reads through a path inherits that path's bug. |
| "The analysis is in the file", followed by one paragraph of prose | The reply is the report, in its slots. The file is the copy the next session reads; the person reads the chat. |
