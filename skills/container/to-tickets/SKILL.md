---
name: to-tickets
description: 'Break a plan, spec or the current conversation into tracer-bullet tickets: issues/ in the task directory, or .issues/<feature-slug>/ outside fleet. Use when the user wants to convert a plan into tickets, create implementation tickets, or break down work.'
---

# To Tickets

Work that fits a single bounded patch leaves this skill here: one accepted behavior, no open product decision, no migration or external-contract change, provable by one focused test. Say so and go straight to TDD.

Break a plan, spec, or conversation into a set of **tickets**: tracer-bullet vertical slices, each declaring the tickets that **block** it. Tickets are **local markdown files**: `issues/` in the task directory (`$FLEET_ARTIFACTS/$SANDBOX_NAME`, layout in `refs/artifacts.md`), or `.issues/<feature-slug>/` outside fleet.

Each ticket is read by a session holding the repository, the parent spec and the ticket, and possibly nothing else. The parent spec carries the sources and decisions shared by the whole feature. The ticket points at what is specific to its slice.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference as an argument (a path like `spec.md` in the task directory), read its full body before drafting.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary (e.g. `CONTEXT.md`), and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests): vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to one gate: one commit, one review
- Any prefactoring should be done first

</vertical-slice-rules>

Give each ticket its **blocking edges**: the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change (rename a column, retype a shared symbol) whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand-contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket, green is promised only there.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct: does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?

Iterate until the user approves the breakdown.

### 5. Write the tickets to local files

With a task directory, the tickets go to `issues/` in it, beside `spec.md`. Without one, pick a `<feature-slug>` for the overall plan (kebab-case, derived from the plan/spec title), reusing the directory if the spec already lives at `.issues/<feature-slug>/spec.md`.

Write one file per approved ticket, `<NN>-<slug>.md`, numbered from `01` in **dependency order** (blockers first), so the numbering itself reflects implementation order and "Blocked by" can reference real filenames. One ticket per file.

Set `Status: ready-for-agent`, so the tickets are agent-grabbable by construction; a status the user named replaces it.

<ticket-template>

# <NN>: <Ticket title>

Status: ready-for-agent
Blocked by: <NN>-<slug>.md, <NN>-<slug>.md, or "None, can start immediately"

## Parent

A reference to the parent spec file (`../spec.md` in a task directory, `.issues/<feature-slug>/spec.md` otherwise) if the source was an existing file: otherwise omit this section. Read it before starting, it carries the sources and decisions shared by the feature.

## Sources

Only what this slice needs beyond the parent spec: the issue, ADR or review comment that constrains it, and the code it copies from. One line each, saying what it holds. Omit the section when the parent spec already covers everything.

## What to build

The end-to-end behaviour this ticket makes work, from the user's perspective: not a layer-by-layer implementation list.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

</ticket-template>

Avoid specific file paths or code snippets in ticket bodies, they go stale fast. A path under Sources is the exception: it is an anchor, so date it and say to re-locate by symbol name if it moved. Second exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.

The parent spec or plan stays as it is; the ticket files are the only files this skill writes.

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom. Work the frontier one ticket at a time with the `implement` skill, in the same session; the ticket files carry the state between tickets.
