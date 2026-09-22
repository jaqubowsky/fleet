---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"), and when the user asks for the architectural problems or improvements of a subsystem."
---

# How

Explore the codebase to answer "how does X work?" questions. Produce clear architectural explanations at the level of a senior engineer onboarding onto a subsystem. Enough to build a working mental model, not annotated source code.

Two modes:

1. **Explain** (default). Explore the codebase and produce a clear explanation
2. **Critique.** Explain first, then take several distinct critique passes to identify architectural issues

## Explain mode

### Step 1. Understand the question and assess complexity

Parse what the user is asking about:

- "How does the rate limiter work?", a subsystem
- "How do we handle billing for on-demand usage?", a feature flow
- "How is the auth service structured?", an architectural overview
- "Walk me through what happens when a user submits a form", a runtime trace

Identify the scope. If ambiguous, state your best-guess interpretation before exploring. Don't ask. Let the user redirect if you're off.

**Assess complexity to decide the approach:**

- **Simple** (a single module, a small utility, a narrow question like "how does function X work"): skip explorer agents; the explainer explores and explains in a single pass. Go to Step 2b.
- **Complex** (a subsystem spanning multiple files/services, a cross-cutting feature, a full architectural overview): take one explorer pass per slice first, then synthesize. Go to Step 2a.

When in doubt, lean simple. Add explorer passes when the direct explanation hits a wall.

### Step 2a. Explore (complex questions only)

Decompose the question into 2-4 parallel exploration angles, each a distinct slice of the subsystem so explorers don't duplicate work. Example split for "how does the rate limiter work?":

- Explorer 1: data model and state management
- Explorer 2: request path and enforcement
- Explorer 3: configuration and metrics infrastructure

The right decomposition depends on the question. Default to three explorers: two when the subsystem sits in one package, four when it spans services or processes.

Run every explorer yourself, one after another, each as its own pass over the code with its own notes; the passes stay separate until Step 3.

Each pass follows `references/explorer-prompt.md` plus a specific exploration angle naming its slice. Each pass:
- Start broad: find for relevant directories, grep for key types/interfaces/class names
- Follow the thread: from an entry point, trace the call chain (callers, callees, data flow, type definitions)
- Read the actual code, don't guess from file names
- Stop when it can describe the full path from input to output (or trigger to effect) without hand-waving any step
- Note things that are surprising, non-obvious, or that a newcomer would get wrong

Each pass ends in structured findings: components found, flow traced, files read, anything non-obvious. Overlap between passes is fine; Step 3 reconciles.

Then proceed to Step 3.

### Step 2b. Direct explain (simple questions)

Explore and explain in one pass.

Do the exploration (find, grep, read) and write the explanation directly. Read `references/explainer-prompt.md` for the communication style and output format. Same structure, just no explorer findings as input.

Proceed to Step 4.

### Step 3. Synthesize (complex questions only)

With every pass done, synthesize their findings into one coherent explanation.

Read `references/explainer-prompt.md` for the template and write the human-facing explanation from all the findings (output format below): reconcile overlaps, resolve contradictions, weave the slices into one picture.

### Step 4. Present

Present the explanation to the user, with context from the conversation where it helps.

The output structure (Overview, Key concepts, How it works, Where things live, Gotchas) lives in `references/explainer-prompt.md`, the one place both paths read it from.

### Done

Every hop from trigger to outcome is named, with no step hand-waved; every concept the explanation uses is defined before it is used; every claim points at a file the reader can open. A hop you could not trace is named as untraced rather than smoothed over, and a question you reinterpreted is stated as the interpretation you answered.

## Critique mode

Triggered when the user asks for architectural issues, problems, or improvements, not just understanding.

### Step 1. Explain first

Run the full explain flow above (Steps 1-4). You must understand the architecture before critiquing it.

### Step 2. Critique passes

After the explanation is complete, run 3-4 critique passes yourself, one per lens (for example: coupling and boundaries, failure modes and operability, data model and invariants, evolution and deletability), each written down before the next starts so they stay distinct.

Read `references/critic-prompt.md` for the prompt template. Each critic gets:
1. The explanation from Step 1 (so they don't re-explore)
2. The relevant file paths (so they can read the actual code)
3. The architectural critique rubric from `references/critique-rubric.md`

### Step 3. Lead judgment

You're a pragmatic lead, not an aggregator.

Categorize findings:
- **Act on.** Architectural problems worth fixing now
- **Consider.** Real concerns, but the cost/benefit is unclear
- **Noted.** Valid observations, low priority
- **Dismissed.** Wrong, missing context, or style preference

Present the explanation first (from Step 1), then the critique verdict below it. The explanation should stand on its own; someone who just wants to understand the system shouldn't wade through critique.

Done when every critic finding carries one of the four verdicts, and each **Act on** finding names the cost of the change beside the problem.
