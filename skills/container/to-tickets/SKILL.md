---
name: to-tickets
description: 'Turn an analysis, a plan or the current conversation into spec.md and tracer-bullet tickets: issues/ in the task directory, or .issues/<feature-slug>/ outside fleet. Use when the user wants a spec, implementation tickets, or work broken down.'
---

# To tickets

Work that fits a single bounded patch leaves this skill here: one accepted behaviour, no open product decision, no migration or external-contract change, provable by one focused test. Say so and go straight to `implement`. In a task directory that call was made in `analysis.md`; this skill runs when the analysis named the pipeline.

Two files come out of it, read by a session that holds the repository and nothing of this conversation: `spec.md`, the decisions shared by the whole feature, and one ticket per slice under `issues/`. The spec carries the sources and the decisions; a ticket points at what is specific to its slice. In a task directory (`$FLEET_ARTIFACTS/$SANDBOX_NAME`, layout in `refs/artifacts.md`) both live there; outside fleet, under `.issues/<feature-slug>/`, the slug kebab-case from the feature title.

## Process

1. **Read what exists.** `analysis.md` when there is one, the reference the user passed, `docs/PRD.md` if it exists (the feature serves a capability the PRD names and keeps its constraints), `CONTEXT.md` for vocabulary, the ADRs in the area. Note every source while it is in hand: tracker issue, ADR, document, pull request, prior art in the code. They go into the spec as pointers, one line each, never summarised.

2. **Write `spec.md`** from the template below. `Status: ready-for-agent` at the top.

3. **Cut the slices.** Each ticket is a tracer bullet: a narrow, complete path through every layer the feature touches (schema, API, UI, tests), demoable on its own, sized to one commit and one review. Prefactoring that makes a slice easy is its own first ticket. Give each ticket its blocking edges: the tickets that must be done before it starts.

   A wide refactor (rename a column, retype a shared symbol) breaks thousands of call sites at once, so no slice lands green: sequence it as expand, migrate in batches sized by blast radius, contract. Each batch is a ticket blocked by the expand; the contract is blocked by every batch.

4. **Confirm the split.** Outside a task directory, show the numbered list (title, blocked by, what it delivers) and ask about granularity and edges until the user approves. In a task directory the split was proposed and answered in `analysis.md` as the pipeline's one question: take it from there, and a change to it is a change to `analysis.md` first.

5. **Write the tickets**, `<NN>-<slug>.md` numbered from `01` in dependency order, so the numbering is the implementation order and "Blocked by" names real files. `Status: ready-for-agent` unless the user named another. The spec stays as written; the tickets are the only other files this skill writes.

Then `implement` works the frontier, one ticket at a time, in this session: any ticket whose blockers are all done.

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

<ticket-template>

# <NN>: <Ticket title>

Status: ready-for-agent
Blocked by: <NN>-<slug>.md, or "None, can start immediately"

## Parent

`../spec.md` in a task directory, `.issues/<feature-slug>/spec.md` otherwise. Read it first: it carries the sources and decisions shared by the feature.

## Sources

Only what this slice needs beyond the spec: the issue, ADR or review comment that constrains it, the code it copies from. Omit when the spec covers everything.

## What to build

The end-to-end behaviour this ticket makes work, from the user's side, never a layer-by-layer list.

## Acceptance criteria

- [ ] <criterion a command or a person can check>

</ticket-template>

File paths and code snippets in ticket bodies go stale; a path under Sources is an anchor, dated, with the symbol name to re-locate it. A prototype snippet that encodes a decision is the exception, trimmed to the decision.
