---
name: to-tickets
description: 'Break work down into tracker tickets. Use only when the user explicitly asks for tracker tickets or a breakdown of work for the tracker.'
---

# To tickets

Each ticket goes to a reader who holds the repository and nothing of this conversation. The tickets are the only thing this skill writes: into the tracker where your seat may write to it, else as text in the reply for the user to file.

## Process

1. **Read what exists.** The analysis when there is one, the reference the user passed, `docs/PRD.md` if it exists (the feature serves a capability the PRD names and keeps its constraints), the repository's written standards (design, UI, implementation rules). Note every source while it is in hand: tracker issue, ADR, document, pull request, prior art in the code. They go into the tickets as pointers.

2. **Settle the product decisions.** A product decision (who may do what, what the user sees, parity with old behaviour) enters a ticket only with the source or the answer that settled it. One nothing settled stops the run here, before any ticket, as a question for the user.

3. **Cut the slices.** Each ticket is one change a person can accept in one sitting. Cut small, so each commit reads as one change: one behaviour per ticket, still a complete path through every layer it touches (schema, API, UI, tests), demoable on its own. Two behaviours on one router and one test file are two tickets, the second blocked by the first. A new ticket also starts where the work reaches a seam the earlier ones never touch, or where one part has to land green before the next can start. Give each ticket its blocking edges: the tickets that must be done before it starts.

   A wide refactor (rename a column, retype a shared symbol) breaks thousands of call sites at once, so no slice lands green: sequence it as expand, migrate in batches sized by blast radius, contract. Each batch is a ticket blocked by the expand; the contract is blocked by every batch.

4. **Confirm the split.** Show the numbered list (title, blocked by, what it delivers) and ask about granularity and edges until the user approves.

5. **Write the tickets** in dependency order, so the order is the implementation order and "Blocked by" names real tickets. Each follows the project's `spec/ticket.md`, or {{refs.ticket}} where the project has none, with its acceptance criteria written out. Each source a ticket rests on is a pointer, one line, never summarised.

File paths and code snippets in ticket bodies go stale. A prototype snippet that encodes a decision is the exception, trimmed to the decision.
