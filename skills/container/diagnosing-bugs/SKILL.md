---
name: diagnosing-bugs
description: 'Use when something is broken, throwing, failing or slow, when the user says "diagnose" or "debug this", or when the user describes a visual, layout or responsiveness defect in their own words and in any language ("it''s crooked", "it jumps", "it flashes", "it lags", "still wrong", "worse now"). Also use unprompted the moment a second attempted fix for the same symptom fails.'
---

# Diagnosing Bugs

A fix is earned by evidence on the user's own symptom. The failure this skill prevents is reading code, forming a theory, and patching against it: such a fix cannot be falsified, which is why the second one fails too.

**Two strikes and you are in this skill.** A second failed fix for the same symptom means the diagnosis was never grounded: stop patching, say so, and start at step 1. The failed patches stay in place until the loop is red; reverting them is a change like any other, proven by the same loop. A patch harmful on its own (a retry on a call not shown to be idempotent) is reverted as its own fix, with its own check.

**Redact** every secret in what you show: `<REDACTED>` in its place, credentials read from env vars, and only the lines of a captured artifact that carry the signal. If the redacted output cannot settle the bug, say so and ask the user.

## Steps

1. **Symptom.** Write down the user's exact symptom: the error text, the wrong output, the timing, the screen and action. Done when a check can tell this symptom from a nearby different one.
2. **Loop.** Build the smallest command that goes red on that symptom: a failing test at the seam that reaches the bug, a curl, a CLI run against a fixture, a `playwright-cli` session (its skill loaded first). Run it and show the invocation and its output. While you build it, a hypothesis labelled as one may choose where to look; it is not yet a cause. Shrink the scenario only while a cut sharpens the next experiment or the regression test. Done when the loop is red on the user's symptom, gives the same verdict on a rerun, and runs unattended in seconds. A visual symptom with no browser automation, a flaky bug, a workspace a test run dirties, or no loop after the cheap options: [references/hard-bugs.md](references/hard-bugs.md).
3. **Cause.** Rank the hypotheses that make different predictions, each stated as "if X is the cause, changing Y turns the loop green". The nearest working example, a sibling route or the same call one commit ago, supplies them: each difference from the broken path is one. Run the experiment that splits the top ones, one variable at a time, debug logs tagged with one prefix such as `[DEBUG-a4f2]`. Done when one hypothesis predicted a result the others did not and the loop showed it. A cause outside your reach, such as a provider's internals, stays unknown even when a synthetic injection reproduces the app's handling of it; the diagnosis says which is which.
4. **Fix.** The regression test goes red first at the seam that reproduces the real pattern; when only a shallower seam exists, that gap is a finding to name. Fix where the bad value is produced, not where it surfaced, and change nothing else in the same commit. Done when the test is green and the step 2 loop, rerun on the original scenario, is green too.
5. **Close.** Grep the debug prefix out, delete throwaway harnesses, and write the diagnosis before or with the fix: symptom, cause, reproduction, what it rests on, what stays open. Name what would have prevented the bug when the answer is structural. Done when the repro no longer reproduces and the cause is recorded where the reviewer reads it.

## Stop

Stop and tell the user, naming what you tried and the one input that would unblock you, when no loop goes red after the options in [references/hard-bugs.md](references/hard-bugs.md), when the next experiment needs access only they have, or when a third fix for this symptom fails. Three fixes deep, each working locally and breaking something else, is a wrong structure rather than a wrong hypothesis: name the coupling you keep hitting and put the structural change on the table before more code.

## Rationalizations

Each row quotes a plan written without this document, on a bug two patches had already failed to fix.

| Excuse | Reality |
|---|---|
| "The repro says one thing: state shared across requests. That is what the next 20 minutes go after." | A symptom's shape names a class of cause, not a cause. The loop goes red on the symptom first; the class is one hypothesis, ranked against its siblings. |
| "The first hit in the submit-to-confirmation path is the suspect." | A grep locates the seam the loop drives. A suspect is a labelled hypothesis: it may pick the next experiment, never the fix. |
| "Fix the cause the grep and the red test point at" at 17:52, with the freeze at 18:00 | A red test plus a theory is step 2. The fix waits for the experiment that splits the hypotheses, and the fix at 17:52 is patch three. |
