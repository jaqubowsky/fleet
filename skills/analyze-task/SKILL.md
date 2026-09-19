---
name: analyze-task
description: 'Use when the user asks to analyze a task, issue, ticket, bug report, or feature specification before implementation, diagnose reported behavior, or determine the required changes and scope, including Linear tickets and mixed bug-and-feature requests.'
---

# Analyze task

## Overview

Produce an evidence-backed requirements analysis: the accepted specification, the evidenced defects that impair use of the same flow, and worthwhile improvements to the code being touched.

This workflow ends at a proposal. Do not implement, do not update tickets, do not start work unless separately asked. Reproduction tests, harnesses and reversible probes are allowed within existing permissions. Keep diagnostic artifacts identifiable, remove temporary instrumentation before handover, report anything retained. Pass this boundary to every delegated agent.

## Read the sources before reading the code

Requirements are not in the ticket title. Work through both lists, or state that a source is missing.

Required, in the tracker (Linear or equivalent):

- the description, then every comment, with author and date
- attachments: screenshots, recordings, files
- every linked issue, followed one level deep: parent, sub-issues, blocks and blocked by, relates to, duplicates. Read their descriptions and comments. Stop descending when a link stops touching the analyzed flow.
- outbound links: Figma, Notion, Slack threads, specification documents, pull requests. List them and say which ones you could open.

Required, in the repository, for the area being changed:

- README at the root and at the module
- CLAUDE.md, AGENTS.md, CONTRIBUTING.md, CONTEXT.md
- `docs/`, in particular `docs/adr/`
- comments and docstrings in the touched files, plus `git log -p` on them where the code looks deliberately odd

Cite every source that changed a conclusion: issue URL, or `path:line`.

User amendments define the current scope. A recommendation in a comment does not. A recorded ADR is overturned deliberately and in writing, never by silence. Where a source contradicts the code, quote both and say which wins: the code and the accepted user scope take precedence.

If a source is unavailable, request its contents, continue independent code discovery, and label the conclusions provisional.

## Choose the investigation path

Choose from the described behavior, not from the issue label or title. State the chosen path.

| Described behavior | Path |
| --- | --- |
| New behavior or capability | REQUIRED SUB-SKILL: use `how` in Explain mode to establish existing behavior and gaps |
| Broken, slow, visually incorrect or regressed | REQUIRED SUB-SKILL: use `diagnosing-bugs`; follow its feedback-loop, reproduction, hypothesis and instrumentation phases |
| Both in one request | Diagnose the defect first, then use `how` for the new behavior; keep causes, fixes and additions distinguishable |

Stop before the fix phase of `diagnosing-bugs`. Present the reproduced symptom, the reproduction command and its result, the supported cause, and the proposed fix with its verification. Blocked reproduction is an incomplete diagnosis, never a fix. Static code reading alone is not a confirmed diagnosis.

If expected behavior is genuinely unclear, ask for it while gathering independent evidence. Do not guess a product requirement in order to classify a bug.

## Trace the current behavior

Follow the actual mounted entry point through selection and state, validation, API, backend effects, and the user-visible outcome. Check callers, feature flags, permissions and alternative paths. Separate active code from unmounted or legacy code. Cover success, failure, cancellation, retry, empty selection and partial validity where relevant. Read the existing tests.

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

REQUIRED SUB-SKILL: use `brain` after the code analysis. Inside a container the wiki is absent: skip this step and say so. Compare recorded decisions with the proposal, cite wiki pages and their sources, report missing knowledge or access honestly. Wiki advice challenges the approach; it does not make a recommendation mandatory.

REQUIRED SUB-SKILL: use `unslop` for the final answer, in the user's language.

The report fits on one screen. Fill these slots, in this order, and write nothing outside them.

### Verdict

At most three sentences: what the task turns out to be, and whether the ticket's scope holds.

### What we are doing and why

Three to five sentences. State the mechanism instead of naming it.

For a feature: the change as a whole, the problem it removes, and the one alternative you rejected, with the reason.

For a bug: the symptom the user sees, the cause, the reproduction command and its result, the fix, and why this fix rather than the other candidate. Name the cause, not the layer where you happened to notice it.

Define a term before using it, and keep one name per concept across the whole report. No framing labels ("the key insight", "at its core"). No metaphor standing in for the mechanism.

### To do

Checklist, ordered by dependency. One line each: the change, where it lands, why it is needed, how it is accepted.

- [ ] Extract the HTTP call out of `sendDocumentToErp` (`erp-export/send.ts:104`). The column guard from WEB-483 rejects any document without a column, and RMK has none. Done when an RMK document sends without hitting it.

Mark a proposed improvement `(optional)` on the same line, with its cost in the same sentence.

### What this rests on

One row per finding that changed a decision. Cells are phrases, not sentences. A source that only confirmed a conclusion you already held is not a finding.

| Finding | Evidence | Consequence |
| --- | --- | --- |
| The SYNCHRONIZER gate is deliberate | review on PR #1910, commit `1114463` | open it in the change that ships delivery |

### Out of scope

One line per item, with the reason.

### Open and unverified

Open questions with the decision each one blocks. Sources you could not open. Checks proposed but not run. One line each.

Rules for the report:

- Cite inside the Evidence column: `path:line`, issue ID, commit. Never a separate section listing what you read.
- No sentence about your own process. Not "I read", not "this changes my earlier conclusion". State the conclusion that holds now.
- A finding that needs a paragraph is two findings, or it belongs in Out of scope.
- At most one small ASCII diagram, and only when the flow has three or more hops and the labels carry the meaning.
- Detail beyond these slots goes to the ticket, or, when asked for, to a file in `$FLEET_ARTIFACTS`. `.issues/` belongs to `to-spec` and `to-tickets`.

## Rationalizations

| Excuse | Reality |
| --- | --- |
| "The description covers it" | Comments and linked issues amend scope. Read them, then say so. |
| "The linked issue is probably unrelated" | One level deep is cheap. Decide after reading, not before. |
| "No docs in this repo" | You have not looked until you checked README, ADRs and the touched files' history. |
| "That ADR is old" | An ADR is overturned in writing, with the driver named. Silence is not an overturn. |
| "The defect predates the ticket" | Reachability during use of the flow decides scope, not the ticket's age. |
| "It is obviously broken" | Obvious still needs code or runtime evidence. |
| "I spent hours on this" | Investigation time is not coverage, and sunk cost is not scope. |
| "It would be cleaner to also refactor X" | Proximity is not a reason. Report it, keep it out of scope. |
| "I might as well fix it while I am here" | The workflow ends at analysis. Fixing is a separate request. |
| "The reader should see how thorough I was" | Thoroughness shows in the findings. A transcript of the search is noise. |
| "This source deserves its own paragraph" | It gets a table row, or it did not change a decision. |

## Red flags

- Scope taken from the ticket title.
- No source list, or a source list without the ones you could not open.
- A recommendation from a comment silently promoted to a requirement.
- A cause claimed without an executed reproduction.
- A reachable user-facing defect dropped because the ticket omits it.
- An unrelated cleanup presented as required work.
- Any edit to production code.
- A section walking through the sources you read.
- A prose paragraph where a table row fits.
- A report longer than one screen.
