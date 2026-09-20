---
name: two-axis-review
description: 'Reviewing a diff against a fixed point on two axes: this repo''s documented standards, and the ticket or spec the work came from. Use when the user asks to review a branch, a PR or work in progress, and after the last commit of a piece of work before it is handed over.'
compatibility: Requires git, jscpd through npx for clone detection, and the `reviewer` sub-agent to run the two axes
---

Two-axis review of the diff between `HEAD` and a fixed point the user supplies:

- **Standards**: does the code conform to this repo's documented coding standards?
- **Spec**: does the code faithfully implement the originating ticket / spec?

Both axes run as **parallel sub-agents** so they don't pollute each other's context, then this skill aggregates their findings. If the `reviewer` sub-agent is unavailable, say so in the final report before starting, then run both axes yourself and keep their findings strictly separate.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point: a commit SHA, branch name, tag, `main`, `HEAD~5`. If they didn't specify one, ask for it.

Capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot, so the comparison is against the merge-base). Also note the list of commits via `git log <fixed-point>..HEAD --oneline`.

Before going further, confirm the fixed point resolves (`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or empty diff fails here, not inside two parallel sub-agents.

### 2. Identify the spec source

Look for the originating spec, in this order:

1. A path the user passed as an argument.
2. Files under `.issues/<feature-slug>/` matching the branch name or feature: the ticket file(s) being implemented plus `spec.md`.
3. Ticket/spec paths referenced in the commit messages.
4. A PRD/spec file elsewhere under `docs/` or `specs/`.
5. If nothing is found, ask the user where the spec is. If they say there isn't one, the **Spec** sub-agent skips and reports "no spec available".

### 3. Identify the standards sources

Anything in the repo that documents how code should be written, such as `CODING_STANDARDS.md`, `CONTRIBUTING.md`, `CLAUDE.md`, or `AGENTS.md`.

Then the personal knowledge base at `/Users/alice/my-knowledge-base/wiki/`: read its `index.md` first (Second brain rule 1). Inside a container that path is absent: skip the wiki, say so in the report, and review from the repo standards and the smell baseline alone. Four pages bear on the verdict of any review, whatever the diff touches:

| Page | What it decides |
| --- | --- |
| `dry-principle.md` | whether repeated code is one piece of knowledge or two: share technical, copy domain, and the forward test "can these change independently?" |
| `ambiguous-architecture-terms.md` | the wording of the findings themselves. "Tightly coupled", "violates SRP", "not clean" carry no argumentative weight; the finding names a pro and a con, or a measurement |
| `code-deletability.md` | a diff that adds or grows a module: delete its folder, how many compilation errors, and how many silent stumps survive |
| `anti-requirements.md` | a diff that grows an entity or a type: invent a fake rule joining two of its attributes, and see whether it sounds absurd |

Scan the index for pages matching the diff's own area and add those too. Collect paths, do not read the pages: the Standards sub-agent reads them itself.

Wiki pages are recorded positions. They rank below documented repo standards, above the smell baseline, and stay judgement calls. Where this codebase contradicts a page, the codebase wins and the finding says so.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** in [smells.md](smells.md): twelve Fowler smells (_Refactoring_, ch.3) and the two rules that bind them, applying even when a repo documents nothing. The Standards sub-agent reads that file itself, so do not load it here.

### 4. Collect clone evidence

Run the detector once, here, not inside the sub-agents, so both axes see the same evidence. [clone-detection.md](clone-detection.md) holds the command, the four rules that bind the step, and what each jscpd flag does. Read it and run what it says.

### 5. Spawn both sub-agents in parallel

Run both as `reviewer` sub-agents in the same turn.

**Standards sub-agent prompt.** Include:

- The full diff command and commit list.
- The list of standards-source files you found in step 3, plus the absolute paths of the wiki pages you picked there, and of `smells.md` next to this skill file. Tell it to read all of them in full before reviewing, and give it the precedence order: repo standards, then wiki positions, then the baseline.
- The filtered clone list from step 4, pasted in full. An empty list is a result: say "detector reported no clones touching the diff". If the detector didn't run, say that instead.
- The brief: "Report, per file/hunk where relevant, (a) every place the diff violates a documented standard: cite the standard (file + the rule); (b) any baseline smell you spot: name it and quote the hunk; and (c) for each clone pair from the detector, rule on it: one piece of knowledge that should be extracted, or two that merely look alike and stay copied, with the reason. The detector matched tokens, not meaning: it never decides on its own. Distinguish hard violations from judgement calls, documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Word every finding so it survives `ambiguous-architecture-terms.md`: name the pro and the con, or the measurement, never a blacklisted label standing alone. Under 400 words."

**Spec sub-agent prompt.** Include:

- The diff command and commit list.
- The path or fetched contents of the spec/ticket(s).
- The brief: "Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Under 400 words."

If the spec is missing, skip the Spec sub-agent and note this in the final report.

### 6. Aggregate

Present both reports under `## Standards` and `## Spec` headings, verbatim or lightly cleaned. Do **not** merge or rerank findings: the axes are deliberately separate (see _Why two axes_).

End with a one-line summary: total findings per axis and the worst issue _within each axis_ (if any). Don't pick a single winner across axes: that's the reranking the separation exists to prevent.

### 7. Done

Every file the diff touches carries a verdict on both axes, every clone pair from step 4 is ruled on (extract or stays copied, with the reason), and an axis that could not run is named with what it would have needed. The review proves the commit it ran against: a fix landing after it means another commit and another run.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the ticket asked but breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.
