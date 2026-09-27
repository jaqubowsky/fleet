---
name: to-tickets
description: 'Turn an analysis, a plan or the current conversation into spec.md and tickets, one commit each: issues/ in the task directory, or .issues/<feature-slug>/ outside fleet. Use when the user wants a spec, implementation tickets, or work broken down.'
---

# To tickets

Work that fits a single bounded patch leaves this skill here: one accepted behaviour, no open product decision, no migration or external-contract change, provable by one focused test. Say so and go straight to `implement`. In a task directory that call was made in `analysis.md`; this skill runs when the analysis named the pipeline.

Two files come out of it, read by a session that holds the repository and nothing of this conversation: `spec.md`, the decisions shared by the whole feature, and one ticket per slice under `issues/`. The spec carries the sources and the decisions; a ticket points at what is specific to its slice. In a task directory (`$FLEET_ARTIFACTS/$SANDBOX_NAME`, layout in {{refs}}) both live there; outside fleet, under `.issues/<feature-slug>/`, the slug kebab-case from the feature title.

## Process

1. **Read what exists.** `analysis.md` when there is one, the reference the user passed, `docs/PRD.md` if it exists (the feature serves a capability the PRD names and keeps its constraints), `CONTEXT.md` for vocabulary, the repository's written standards (design, UI, implementation rules), the ADRs in the area. Note every source while it is in hand: tracker issue, ADR, document, pull request, prior art in the code. They go into the spec as pointers, one line each, never summarised.

2. **Write `spec.md`** from the template below. `Status: ready-for-agent` at the top. A product decision (who may do what, what the user sees, parity with old behaviour) enters `Decisions` only with the source or the answer that settled it. One nothing settled stops the run here, before any ticket, as the one question in `analysis.md`, in the shape `analyze-task` gives it, under `status: blocked`.

3. **Cut the slices.** Each ticket is one commit and at most one review. Cut small, so each commit reads as one change: one behaviour per ticket, still a complete path through every layer it touches (schema, API, UI, tests), demoable on its own. Two behaviours on one router and one test file are two tickets, the second blocked by the first. A new ticket also starts where the work reaches a seam the earlier ones never touch, or where one part has to land green before the next can start. Give each ticket its blocking edges: the tickets that must be done before it starts.

   A wide refactor (rename a column, retype a shared symbol) breaks thousands of call sites at once, so no slice lands green: sequence it as expand, migrate in batches sized by blast radius, contract. Each batch is a ticket blocked by the expand; the contract is blocked by every batch.

4. **Confirm the split.**
   - Outside a task directory: show the numbered list (title, blocked by, what it delivers) and ask about granularity and edges until the user approves
   - In a task directory: the split was the last item of the pipeline's one question in `analysis.md`; quote there what accepted it. An order to deliver end to end accepts the split as cut. An answer accepts the split it names and nothing more: a split it never named, or one that changed after the question went out, goes back as the one question under `status: blocked`

   A change to the split is a change to `analysis.md` first.

5. **Write the tickets**, `<NN>-<slug>.md` numbered from `01` in dependency order, so the numbering is the implementation order and "Blocked by" names real files. Each follows the project's `spec/ticket.md`, or {{refs.ticket}} where the project has none. `Status: ready-for-agent` unless the user named another. The spec stays as written; the tickets are the only other files this skill writes.

Then `implement` works the frontier, one ticket at a time: any ticket whose blockers are all done. In a task directory the written tickets are a natural break: suggest a session handoff first, as the container rule says.

<spec-template>

# <Feature title>

Status: ready-for-agent

## Sources

One line each: the reference and what it holds. Tracker issues with the amendments comments made; ADRs binding this area with the constraint in one line; documents; prior art in the code with the date checked, re-located by symbol name if the path moved; external links and whether they were reachable. File paths belong here only.

## Problem

What the user cannot do today, from the user's side.

## Solution

What the feature does, from the user's side, and the one alternative turned down, with the reason.

## Decisions

Modules built or changed and their interfaces, schema and API contracts, the specific interactions. One line per alternative rejected, with the reason, so the next session does not rediscover a dead end. A prototype snippet that encodes a decision more precisely than prose (a state machine, a reducer, a schema) is inlined, trimmed to the decision.

## Testing

The seams the tests sit at, the prior art for them in the codebase, and what a test here verifies: external behaviour, never implementation detail.

## Out of scope

One line each.

</spec-template>

File paths and code snippets in ticket bodies go stale; a path under Scope is an anchor, dated, with the symbol name to re-locate it. A prototype snippet that encodes a decision is the exception, trimmed to the decision.
