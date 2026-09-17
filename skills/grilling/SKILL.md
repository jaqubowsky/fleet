---
name: grilling
description: 'Interview the user relentlessly about a plan, decision, or idea until reaching shared understanding, resolving each branch of the decision tree. Use when the user wants to stress-test their thinking, get grilled on a design, or mentions "grill me". In a repo the session also lands terminology and decisions in `CONTEXT.md` and ADRs.'
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

```
Q1. **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

-> <your recommended answer>

---

Q2. **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

-> <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a `scout` sub-agent (repository) or `researcher` (outside facts) to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.

If we are in a repo, run this session using the `domain-modeling` skill, so terminology lands in `CONTEXT.md` and hard-to-reverse decisions become ADRs as they are settled.
