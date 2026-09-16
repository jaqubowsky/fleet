---
name: to-spec
description: 'Turn the current conversation into a feature spec written to a local markdown file under .issues/<feature-slug>/spec.md: no interview, just synthesis of what was already discussed. Use when the user wants a spec for a single feature from the current context. Skip a single bounded patch (one accepted behavior, no open product decision, no migration or external-contract change, provable by one focused test): that goes straight to TDD, no spec.'
---

This skill takes the current conversation context and codebase understanding and produces a spec (you may know this document as a PRD). Do NOT interview the user: just synthesize what you already know.

The spec is written as a **local markdown file**, not published to a hosted issue tracker.

The implementer will be a fresh session that never saw this conversation. It needs to know which sources exist and can be consulted: tracker issues, ADRs, documents, prior art. Point at them, do not summarize them.

## Process

1. Read `docs/PRD.md` if it exists: the feature must serve a capability the PRD names and must not contradict its Constraints. Then explore the repo to understand the current state of the codebase, if you have not already. Use the project's domain glossary vocabulary (e.g. `CONTEXT.md`) throughout the spec, and respect any ADRs in the area you're touching.

2. Note the sources this conversation drew on while you still have them: tracker issues, ADRs, specification documents, pull requests, prior art in the code. They go in the spec as pointers, one line each.

3. Sketch out the seams at which you're going to test the feature. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can. The fewer seams across the codebase, the better: the ideal number is one.

Check with the user that these seams match their expectations.

4. Write the spec using the template below. Pick a `<feature-slug>` (kebab-case, derived from the feature title) and write the spec to `.issues/<feature-slug>/spec.md`, creating the directory if needed. Set `Status: ready-for-agent` near the top: no further triage needed. Once written, run the `to-tickets` skill to break the spec into tracer-bullet ticket files alongside it.

<spec-template>

# <Feature title>

Status: ready-for-agent

## Sources

Where the implementer can read more. One line each: the reference, and what it holds.

- tracker issues: ID, URL, and what it contributes. Note when comments amended the scope.
- ADRs and recorded decisions binding this area: number, path, and the constraint in one line.
- documents: specification, PRD section, `CONTEXT.md`.
- prior art: the existing code this feature copies its shape from, with the date checked. Re-locate by symbol name if the path moved.
- external links, and which ones were reachable during research.

Stable identifiers (issue IDs, ADR numbers, commit SHAs, PR numbers, symbol names) can appear anywhere in the spec. File paths belong in this section only.

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Add the alternatives that were turned down, one line each with the reason, so the next session does not rediscover a dead end.

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts: not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this spec.

## Further Notes

Any further notes about the feature.

</spec-template>
