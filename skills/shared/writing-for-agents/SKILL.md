---
name: writing-for-agents
description: 'Writing for an agent to read. Use before creating or editing a rule or ref under rules/, a skill, AGENTS.md or CLAUDE.md.'
---

Reference for writing anything an agent consumes: a skill, an `AGENTS.md` / `CLAUDE.md`, a doc reached by a pointer, a prompt sent to another agent. The packaging differs; the writing does not: the same levers make each one predictable, since the agent takes the same _process_ every run rather than producing the same output.

When the document you're writing is a skill, read [`SKILL-MECHANICS.md`](SKILL-MECHANICS.md) for the invocation choice, router skills, the frontmatter and directory format, bundled scripts, and testing a description.

## Context pointers

A **context pointer** is a reference held in the agent's context that names some out-of-context material and encodes the condition for reaching it. A skill's description is one; a line in `AGENTS.md` naming a doc is the same object. The pointer's _wording_, not its target, decides when the agent reaches the material, and how reliably. A must-have target behind a weakly worded pointer is a variance bug: sharpen the wording first, and inline the material only if sharpening fails.

A pointer does two jobs: state what the material is, and list the **branches** that should trigger reaching it (a branch is a distinct case the document handles, so different runs take different paths through it). Every word of an always-loaded pointer costs on every turn, so it earns even harder pruning than the body:

- **Front-load the leading word**: the pointer is where it does its triggering work.
- **One trigger per branch.** Synonyms that rename a single branch are one branch written twice; collapse them and keep only genuinely distinct branches.
- **Cut identity the body already carries.**

## The two loads

Every document and pointer you add spends one of two budgets:

- **Context load** is the cost of always-loaded material on the agent's window: an `AGENTS.md` line, a skill description, anything sitting in context every turn, spending tokens and attention whether or not it fires.
- **Cognitive load** is the cost on the human: which documents exist and when to reach for each. The human is the index. Not a cost to minimise: it is the price of human agency; spend it where human judgement matters, remove it where it does not.

Material reached only through a pointer escapes context load at the price of the pointer's own line; material with no pointer at all rides entirely on cognitive load.

## Information hierarchy

A document is built from two content types: **steps** (the ordered actions the agent performs) and **reference** (definitions, rules, facts consulted on demand). The two mix freely: all steps (a recipe), all reference (a review's rules, this skill), or both. The core decision is where each piece sits on the **information hierarchy**, a ladder ranked by how immediately the agent needs the material:

1. **In-file step** is the primary tier: what the agent does, in order.
2. **In-file reference** is consulted on demand. Often a legitimately flat peer-set (every rule of a review on one rung), which is a fine arrangement, not a smell.
3. **Disclosed reference** is pushed out into a separate file, reached by a context pointer, loaded only when the pointer fires. Spans a sibling file in the same folder through fully external reference that lives anywhere and any document can point at.

Push too little down and the top bloats; push too much and you hide material the agent actually needs. That tension is the whole decision.

**Progressive disclosure** is the move down the ladder (out of the main file and behind a pointer) so the top stays legible. Not primarily a token optimisation: it is how the hierarchy is protected. Branching is the cleanest disclosure test: inline what every branch needs, and push behind a pointer what only some branches reach. When a document has steps, in-file reference that should be disclosed buries them and turns attending to them into a coin-flip: a variance lever, not just a legibility one.

**Co-location** is the within-file companion: where the ladder decides _how far down_ a piece sits, co-location decides _what sits beside it_ once there. Keep a concept's definition, rules, and caveats under one heading rather than scattered, so reading one part brings its neighbours with it. The test: the document should read like documentation written for the agent. Grouped material reads that way; scattered material does not. (Distinct from duplication: that repeats one meaning in two places; scattering fragments one meaning across many.)

A **gotcha** resists the ladder: an environment fact that defies a reasonable assumption (the table that soft-deletes, the health endpoint that answers while the database is down) pays off only if the agent reads it _before_ it acts, and it cannot fire a pointer for a trap it does not know exists. Gotchas stay in the main file even when bulk argues for disclosure.

**Sprawl** is the failure mode here: a document simply too long, even when every line is live and unique. Attention thins across the excess, and every extra line is one more to keep relevant. The cure is the ladder: disclose reference behind pointers, and split by branch or sequence so each path carries only what it needs.

## Steps and completion criteria

Every step ends on a **completion criterion**, the condition that tells the agent the work is done. Two properties make it a lever:

- **Clarity**: can the agent tell done from not-done? A vague bound ("understanding reached") invites **premature completion**: ending the step before it is genuinely done, attention slipping to _being done_. The visible steps still ahead (the **post-completion steps**) supply the pull; the criterion's clarity is the resistance. Defend in order: **sharpen the bound first** (local and cheap); only if it is irreducibly fuzzy _and_ you observe the rush, hide the later steps by splitting the sequence. Hiding only works across a real context boundary (a hand-off or a subagent dispatch; an inline call leaves the later steps in context and clears nothing).
- **Demand**: how much it requires. "Every modified model accounted for" forces thorough work where "produce a change list" does not. Demand drives **legwork** (the digging the agent does within the work, latent in the wording rather than written as its own step), and it is not step-bound: "every rule applied" binds a body of flat reference just as "every step done" binds a sequence, which is how an all-reference document still carries an exhaustiveness bar.

The strongest criteria are both checkable and exhaustive. Checkable is strongest when a command decides it: do the work, run the validator, fix what it prints, repeat until it passes, so the criterion rests on observable state rather than the agent's sense of done. For batch or destructive work, put the plan in a file first and validate _it_ against the source of truth before anything executes; the validator's message is what the agent self-corrects from, so it names the offending item and the legal alternatives.

## Calibrating control

Prescription is a dial, set per passage rather than per document:

- **Match it to fragility.** An operation where a wrong variant is expensive or irreversible gets the exact command and nothing to interpret. Where several routes work, give the _reason_ instead of the directive: an agent holding the purpose decides well in the case you did not foresee, where a rigid step only fits the case you did.
- **Defaults, not menus.** Equal options spend the agent's attention on choosing and invite a different pick every run. Name one default, then the escape hatch with the condition that opens it.
- **Show the shape.** An output format pattern-matches from a concrete skeleton far better than from prose describing it. Short skeleton inline; long, or reached by only some branches, behind a pointer.

The form follows the failure the baseline showed, and the wrong form measurably backfires:

| Baseline failure | Form |
| --- | --- |
| Knows the rule, skips it under pressure | A hard prohibition, each excuse it meets quoted beside its counter |
| Complies, but the output has the wrong shape | A recipe: what the output _is_, its parts in order. A prohibition here ("don't restate") produced _more_ of the unwanted content than no guidance at all |
| Omits an element it already produces | A required slot in the template it fills |
| Should depend on a condition | A conditional on an observable predicate ("if the brief exists, cite it"), never a rule plus exemptions |

Two wording facts from the same tests: a nuance clause ("unless it matters") appended to a working recipe turned consistent output noisy, so a real exception is its own conditional; and an exemption clause does not scope ("the limit does not apply to code blocks" still suppressed them), so what must be exempt is restructured out of the rule's reach.

## When to split

Splitting one document into two spends one of the two loads, so split only when the cut earns it:

- **By sequence**: split a run of steps where the post-completion steps tempt the agent to rush the one in front of it. Keeping them out of view drives more legwork on the current task. Beware the reverse: merging sequences exposes each step's later steps to what follows, inviting premature completion.
- **By invocation**, skill-specific: see [`SKILL-MECHANICS.md`](SKILL-MECHANICS.md).

## Leading words

A **leading word** is a compact concept already living in the model's pretraining that the agent thinks with while running the document (_lesson_, _fog of war_, _tracer bullets_). Repeated as a token, never as a sentence, it accumulates a distributed definition and anchors a whole region of behaviour in the fewest tokens, by recruiting priors the model already holds. Coining your own works if you define it clearly, but a made-up word recruits no priors: you pay in definition tokens what a pretrained word gives free; reach for an existing word first.

It anchors twice. In the body, _execution_: the agent reaches for the same behaviour every time the word appears, and inside flat reference it focuses attention on a class of thing to look for. In a pointer, _invocation_: when the same word lives in your prompts, your docs, and your codebase, the agent links that shared language to the material and reaches it more reliably.

Hunt for opportunities to refactor with leading words. A triad spelled out at three sites, a pointer spending a sentence to gesture at one idea. Each is a passage begging to collapse into a single token:

- "fast, deterministic, low-overhead" → _tight_ (a _tight_ loop).
- "a loop you believe in" → _red_, turning a fuzzy gate into a binary observable state (the loop goes _red_ on the bug, or it doesn't).

You win twice: fewer tokens, and a sharper hook for the agent to hang its thinking on. Assume every document is carrying restatements that leading words retire. Go find them.

**Negation** is the failure mode beside this lever: steering by prohibition drags the forbidden behaviour into context and makes it _more_ available, not less. _Don't think of an elephant_, and the elephant is all there is; the negation is a weak modifier the strongly-activated concept overruns, so the ban half-reads as an instruction to do the thing. Prompt the **positive**: state the target behaviour ("write one-line comments") so the banned one is never spoken. A prohibition earns its place as a hard guardrail you cannot phrase positively, or as the form for a rule the agent knows and skips under pressure (the table in Calibrating control); even then, pair it with the positive target so attention lands on what to do.

## Pruning

- Keep each meaning in a **single source of truth**: one authoritative place, so changing the behaviour is a one-place edit. **Duplication** (the same meaning in more than one place) costs maintenance and tokens, and inflates a meaning's prominence on the ladder past its real rank. (The accidental inverse of a leading word, which repeats a token on purpose, never the meaning.)
- The **environment** is a source of truth too (`package.json` scripts, config files, the directory layout, `--help` output), and a document that restates it is a **cache**: a copy of a lookup, earning its load only when the lookup is expensive. Cache what the agent cannot find by looking: the unwritten convention, the reason behind a choice, the gotcha no config confesses. Leave the one-file, one-command lookups to the environment, where they cannot go stale.
- Check every line for **relevance**: does it still bear on what the document does? A line loses relevance by never bearing on the task (mere exposition, or a branch that should be disclosed) or by going stale as the behaviour or world it describes changes. Shorter documents are easier to keep relevant. Without a pruning discipline the default fate is **sediment**: stale layers that settle because adding feels safe and removing feels risky, until you must core down through them to find what is still live.
- A constraint a validator, a hook or a regex can enforce is a **mechanism**, not a sentence: automate it, and spend the document on the judgement calls a mechanism cannot make.
- Hunt **no-ops** sentence by sentence: an instruction the model already obeys by default pays load to say nothing. The test (does it change behaviour versus the default?) is model-relative, not reader-relative: two people disagreeing about a no-op disagree about the default, and settle it by running the document, not by debate. When a sentence fails, delete the whole sentence rather than trim words from it. The test also grades leading words: a word too weak to beat the default (_be thorough_ when the agent is already thorough-ish) is a no-op, and the fix is a stronger word (_relentless_), not a different technique.

## Refining against runs

Every lever here is a claim about behaviour, so the document is settled by running it, not by reading it. Run it on a real task and read the _trace_, not just the output: wasted moves name their own cause. Thrashing between approaches is a vague completion criterion; a step followed where it does not apply is reference that belongs behind a branch pointer; visible deliberation is a menu missing its default.

Two comparisons pay for themselves. Against no document at all: if the unaided run is just as good, the document buys nothing and its load is pure cost. Against the previous version: that is where a wording change proves it generalised rather than fitted the one prompt you were staring at.

Feed corrections back. A mistake you had to fix by hand is a gotcha the document owed the agent, and it is the cheapest line you will ever add.

Wording is checked before a full run is paid for: five or more fresh-context runs per variant, the document in the position it will hold in production, and a control with no guidance at all, since a control that never fails means there is nothing to fix. Read every flagged output yourself; a counted match is often the template echoing. Variance is the score: reps converging on one shape mean the wording binds, five interpretations mean it does not, and the fix is a tighter form before more words. Where the output is creative, a design or a set of ideas, convergence can also be lost range: compare the spread of ideas against the control, since guidance that narrows five ideas to one has bound the wrong thing.

Run the reps on every model the document will run on. A failure can live in one model only: a fix aimed at it, tested on another, measures nothing, and can still narrow the model that never failed.

The kind of document picks the test. A technique is tested by applying it to a new case, a variation of it, and a case its steps leave a gap on. A reference is tested by retrieval: can the agent find the fact and use it. A pattern is tested by recognition, including the case where it does not apply.

A discipline document, one the agent has an incentive to skip, is baselined under pressure, since a quiz only makes it recite the rule: a realistic scenario stacking three pressures (a deadline, hours of sunk work, a senior saying skip it, end of day), real paths, and a forced choice between named options with no way to defer. Run it without the document first and write the excuses down verbatim; the document then answers those excuses and no hypothetical ones. A rationalization row stands on one of two grounds: a quote from a run behind it, or an axis no baseline has measured yet. Cutting a row without a measurement on its axis is the same error as adding one without. When the agent reads the document and still picks wrong, ask it how the document should have been written to make the right option the only one: _it was clear and I ignored it_ wants a stronger principle, _it should have said X_ wants X added in its words, _I did not see that section_ wants the point moved up.
