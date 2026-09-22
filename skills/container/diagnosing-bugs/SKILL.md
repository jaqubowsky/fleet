---
name: diagnosing-bugs
description: 'Use when something is broken, throwing, failing or slow, when the user says "diagnose" or "debug this", or when the user describes a visual, layout or responsiveness defect in their own words and in any language ("it''s crooked", "it jumps", "it flashes", "it lags", "still wrong", "worse now"). Also use unprompted the moment a second attempted fix for the same symptom fails.'
---

# Diagnosing Bugs

A discipline for hard bugs, one phase gate at a time.

## The rule

**No hypothesis before a red-capable loop exists.**

The failure this skill prevents is reading code, forming a theory, and patching against it. That path produces fixes that cannot be falsified, which is why the second one fails too.

**Two strikes and you are in this skill.** A second failed fix for the same symptom means the diagnosis was never grounded, so stop patching and enter at Phase 1 regardless of how the bug was reported. Say that you are doing it and why.

The failed patches stay in place until the loop is red: a revert is a change like any other, and it goes out with the real fix, proven by the same loop. A patch that is harmful on its own (a retry on a call not shown to be idempotent) is reverted as its own fix, with its own check.

When exploring the codebase, read `CONTEXT.md` (if it exists) to get a clear mental model of the relevant modules, and check ADRs in the area you're touching.

## Redact

This skill has you show commands, outputs and captured artifacts. **Redact every secret first**: write `<REDACTED>` in its place. Build loops against env vars, so the credential stays in the environment rather than in what you show. Captured artifacts carry auth headers: quote only the lines that carry the signal.

If the redacted output is not enough to diagnose the bug, say so and ask the user.

## Phase 1: Build a feedback loop

**This is the skill.** Everything else is mechanical. If you have a **tight** pass/fail signal for the bug, one that goes red on _this_ bug, you will find the cause; bisection, hypothesis-testing, and instrumentation all just consume it. If you don't have one, no amount of staring at code will save you.

Spend disproportionate effort here. **Be aggressive. Be creative. Refuse to give up.**

### Ways to construct one: try them in roughly this order

1. **Failing test** at whatever seam reaches the bug: unit, integration, e2e.
2. **Curl / HTTP script** against a running dev server.
3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.
4. **Headless browser script** (Playwright / Puppeteer): drives the UI, asserts on DOM/console/network.
5. **Replay a captured trace.** Save a real network request / payload / event log to disk; replay it through the code path in isolation.
6. **Throwaway harness.** Spin up a minimal subset of the system (one service, mocked deps) that exercises the bug code path with a single function call.
7. **Property / fuzz loop.** If the bug is "sometimes wrong output", run 1000 random inputs and look for the failure mode.
8. **Bisection harness.** If the bug appeared between two known states (commit, dataset, version), automate "boot at state X, check, repeat" so you can `git bisect run` it.
9. **Differential loop.** Run the same input through old-version vs new-version (or two configs) and diff outputs.
10. **HITL bash script.** If a human must click, drive _them_ with `scripts/hitl-loop.template.sh` so the loop is still structured. Captured output feeds back to you.

**Visual symptom plus no browser automation goes straight to #10.** In a session with no browser automation (no Playwright, no devtools, no screenshot tool), options 1 through 9 cannot reach a layout, overlap, alignment or paint bug, and grinding on them burns the session. The person at the keyboard is the instrument, and a structured HITL loop is a real loop that satisfies Phase 1: name the single measurement you need this round (one computed style, one bounding box, one console line, one screenshot), ask for exactly that, and feed it back in. What you must not do is treat the missing automation as permission to skip to Phase 3.

**"Something dirties the workspace during the test run"** (a stray `.git`, a file written outside tmp, a leaked lockfile) has a ready-made loop: `bash scripts/find-polluter.sh <path-that-appears> <test-glob>` runs the suite file by file and stops at the first one that creates it (`TEST_CMD` overrides the default `npm test`).

Build the right feedback loop, and the bug is 90% fixed.

### Tighten the loop

Treat the loop as a product. Once you have _a_ loop, **tighten** it:

- Can I make it faster? (Cache setup, skip unrelated init, narrow the test scope.)
- Can I make the signal sharper? (Assert on the specific symptom, not "didn't crash".)
- Can I make it more deterministic? (Pin time, seed RNG, isolate filesystem, freeze network.)

A 30-second flaky loop is barely better than no loop; a 2-second deterministic one is tight: a debugging superpower.

### Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100x, parallelise, add stress, narrow timing windows, inject sleeps. A 50%-flake bug is debuggable; 1% is not: keep raising the rate until it's debuggable.

### When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried. Ask the user for: (a) access to whatever environment reproduces it, (b) a redacted captured artifact (HAR file, log dump, core dump, screen recording with timestamps), or (c) permission to add temporary production instrumentation. Do **not** proceed to hypothesise without a loop.

### Completion criterion: a tight loop that goes red

Phase 1 is done when the loop is **tight** and **red-capable**: you can name **one command**, a script path, a test invocation, a curl, that you have **already run at least once** (show the invocation and its output, redacted), and that is:

- [ ] **Red-capable**, it drives the actual bug code path and asserts the **user's exact symptom**, so it can go red on this bug and green once fixed. Not "runs without erroring", it must be able to _catch this specific bug_.
- [ ] **Deterministic**: same verdict every run (flaky bugs: a pinned, high reproduction rate, per above).
- [ ] **Fast**: seconds, not minutes.
- [ ] **Agent-runnable**: you can run it unattended; a human in the loop only via `scripts/hitl-loop.template.sh`.

If you catch yourself reading code to build a theory before this command exists, **stop: jumping straight to a hypothesis is the exact failure this skill prevents.** No red-capable command, no Phase 2.

## Phase 2: Reproduce + minimise

Run the loop. Watch it go red: the bug appears.

Confirm:

- [ ] The loop produces the failure mode the **user** described: not a different failure that happens to be nearby. Wrong bug = wrong fix.
- [ ] The failure is reproducible across multiple runs (or, for non-deterministic bugs, reproducible at a high enough rate to debug against).
- [ ] You have captured the exact symptom (error message, wrong output, slow timing) so later phases can verify the fix actually addresses it.

### Minimise

Once it's red, shrink the repro to the **smallest scenario that still goes red**. Cut inputs, callers, config, data, and steps **one at a time**, re-running the loop after each cut: keep only what's load-bearing for the failure.

Why bother: a minimal repro shrinks the hypothesis space in Phase 3 (fewer moving parts left to suspect) and becomes the clean regression test in Phase 5.

Done when **every remaining element is load-bearing**: removing any one of them makes the loop go green.

Do not proceed until you have reproduced **and** minimised.

## Phase 3: Hypothesise

Generate **3-5 ranked hypotheses** before testing any of them. Single-hypothesis generation anchors on the first plausible idea.

Each hypothesis must be **falsifiable**: state the prediction it makes.

> Format: "If <X> is the cause, then <changing Y> will make the bug disappear / <changing Z> will make it worse."

If you cannot state the prediction, the hypothesis is a vibe: discard or sharpen it.

### Source hypotheses from a working example

Before theorising from the broken code alone, find the nearest thing that works: the sibling route that renders right, the adjacent test that passes, the same call one commit ago, the reference implementation of the pattern being copied. Read it in full rather than skimming for the part you expect to differ.

Then diff it against the broken path and list **every** difference, including the ones you are certain don't matter. "That can't matter" is where the cause hides. Each difference is a hypothesis that arrives with its prediction attached: make the broken path match on that one axis, and the loop goes green.

No working example within reach: say so, and rank on mechanism instead.

**Show the ranked list to the user before testing.** They often have domain knowledge that re-ranks instantly ("we just deployed a change to #3"), or know hypotheses they've already ruled out. Cheap checkpoint, big time saver. Don't block on it: proceed with your ranking if the user is AFK.

## Phase 4: Instrument

Each probe must map to a specific prediction from Phase 3. **Change one variable at a time.**

Tool preference:

1. **Debugger / REPL inspection** if the env supports it. One breakpoint beats ten logs.
2. **Targeted logs** at the boundaries that distinguish hypotheses.
3. Never "log everything and grep".

**Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup at the end becomes a single grep. Untagged logs survive; tagged logs die.

### When you cannot even name the failing layer

Multi-component path (CI job to build script to signing, browser to API to worker to database), and every hypothesis lands on "somewhere in there": stop guessing the layer and bisect it. One instrumented run that logs, at **every** boundary, what data enters, what leaves, and what config or environment each side actually sees. One pass localises the break to a single hop, and Phase 3 restarts with a hypothesis space one layer wide.

This is the one case where broad logging beats a targeted probe, and it is bisection rather than fishing: boundaries chosen up front, one run, `[DEBUG-...]` tags like every other probe, and env values printed as present/absent rather than as their values.

### Perf branch

For performance regressions, logs are usually wrong. Instead: establish a baseline measurement (timing harness, `performance.now()`, profiler, query plan), then bisect. Measure first, fix second.

## Phase 5: Fix + regression test

Write the regression test **before the fix**, but only if there is a **correct seam** for it.

A correct seam is one where the test exercises the **real bug pattern** as it occurs at the call site. If the only available seam is too shallow (single-caller test when the bug needs multiple callers, unit test that can't replicate the chain that triggered the bug), a regression test there gives false confidence.

**If no correct seam exists, that itself is the finding.** Note it. The codebase architecture is preventing the bug from being locked down. Flag this for the next phase.

If a correct seam exists:

1. Turn the minimised repro into a failing test at that seam.
2. Watch it fail.
3. Apply the fix.
4. Watch it pass.
5. Re-run the Phase 1 feedback loop against the original (un-minimised) scenario.

**Fix at the source, not where the error surfaced.** A stack trace shows where a bad value detonated. Trace it up the call chain until you reach the place that produced it, and fix there; a guard at the crash site only converts a wrong value into a caught wrong value.

**One fix, nothing riding along.** No "while I'm here" refactor, no second suspected bug bundled in. When the fix doesn't work, you need to know which change was responsible.

## Phase 6: Cleanup + post-mortem

Required before declaring done:

- [ ] Original repro no longer reproduces (re-run the Phase 1 loop)
- [ ] Regression test passes (or absence of seam is documented)
- [ ] All `[DEBUG-...]` instrumentation removed (`grep` the prefix)
- [ ] Throwaway prototypes deleted (or moved to a clearly-marked debug location)
- [ ] The hypothesis that turned out correct is stated in the commit / PR message, so the next debugger learns

In a task directory (`$FLEET_ARTIFACTS/$SANDBOX_NAME`, layout in {{refs}}) the diagnosis is `analysis.md`, in the shape skill `analyze-task` gives it: the verdict with symptom, cause and reproduction, what it rests on, out of scope, open. It is written when the cause is named, before the fix, so the reviewer reads the same finding the fix answers.

**Then ask: what would have prevented this bug?** If the answer involves architectural change (no good test seam, tangled callers, hidden coupling), name it with the specifics. Make the recommendation **after** the fix is in, not before: you have more information now than when you started.

## Escalation: three fixes deep puts the architecture on trial

Count the fixes applied to this symptom. At the third failure, stop. Do not attempt a fourth.

The tell is the shape of the failures rather than their number: each fix works locally and surfaces a new problem elsewhere, or the obvious fix turns out to need a rewrite of something adjacent. That is not a bad hypothesis, that is a wrong structure, and another patch buys nothing.

Say it to the user in those terms, name the coupling you keep colliding with, and put the structural change on the table before writing more code.

## Rationalizations

Each row quotes a plan written without this document, on a bug two patches had already failed to fix.

| Excuse | Reality |
|---|---|
| "The repro says one thing: state shared across requests. That is what the next 20 minutes go after." | A symptom's shape names a class of cause, not a cause. The loop goes red on the symptom first; the class is Phase 3 material, ranked against its siblings. |
| "The first hit in the submit-to-confirmation path is the suspect." | A grep locates the seam the loop drives. A suspect is a hypothesis, and a hypothesis before red is the failure this skill prevents. |
| "Fix the cause the grep and the red test point at" at 17:52, with the freeze at 18:00 | The loop earns a fix only after it is red, minimised and the hypothesis tested against it. A red test plus a theory is Phase 2, and the fix at 17:52 is patch three. |

## Quick reference

| Phase | Gate you cannot pass without |
|---|---|
| 1. Feedback loop | One command, already run, red-capable, deterministic, fast |
| 2. Reproduce + minimise | The user's exact symptom, every remaining element load-bearing |
| 3. Hypothesise | 3-5 ranked, each with a stated prediction |
| 4. Instrument | Each probe maps to one prediction, one variable at a time, tagged |
| 5. Fix + test | Test written first at a correct seam, or absence of the seam documented |
| 6. Cleanup | Repro gone, tags grepped out, cause recorded |
