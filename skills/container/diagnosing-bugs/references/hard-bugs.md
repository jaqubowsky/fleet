# Hard bugs

Reached from step 2 or step 3 of the skill when the cheap loop is not enough.

## More ways to build a loop

1. **Replay a captured trace.** Save a real request, payload or event log to disk and replay it through the code path in isolation.
2. **Throwaway harness.** A minimal subset of the system, one service with its dependencies doubled, that reaches the bug's code path in one call.
3. **Property or fuzz loop.** For "sometimes wrong output", run a thousand random inputs and look for the failure mode.
4. **Bisection harness.** For a bug that appeared between two known states (commit, dataset, version), automate "boot at state X, check" and `git bisect run` it.
5. **Differential loop.** Run one input through the old and the new version, or two configs, and diff the outputs.
6. **HITL script.** If a human must act, drive them with `scripts/hitl-loop.template.sh` so the loop stays structured and its output comes back to you.

**Visual symptom with no browser automation** (no Playwright, devtools or screenshot tool): go straight to the HITL script. The person at the keyboard is the instrument. Name the single measurement you need this round, one computed style, one bounding box, one console line, one screenshot, ask for exactly that, and feed it back.

**Something dirties the workspace during the test run** (a stray `.git`, a file written outside tmp, a leaked lockfile): `bash scripts/find-polluter.sh <path-that-appears> <test-glob>` runs the suite file by file and stops at the first one that creates it (`TEST_CMD` overrides the default `npm test`).

**Non-deterministic bugs.** The goal is a higher reproduction rate, not a clean repro: loop the trigger a hundred times, parallelise, add stress, narrow timing windows. Raise the rate until a run tells the hypotheses apart.

**No loop at all.** Ask the user for access to the environment that reproduces it, a redacted captured artifact (HAR file, log dump, screen recording with timestamps), or permission to add temporary production instrumentation.

## Finding the layer

On a multi-component path (CI job to build script to signing, browser to API to worker to database) where every hypothesis lands on "somewhere in there", bisect the layers instead of guessing. One instrumented run logs, at every boundary chosen up front, what data enters, what leaves, and what config each side sees, env values as present or absent rather than their values, all under one `[DEBUG-...]` tag. That run localises the break to one hop.

A difference between a working and a broken environment is ruled out only by reading it from the failing environment itself: the deployed image (`node -p process.versions`), the lockfile at the deployed tag. A proxy, a registry date or the local runtime, keeps the hypothesis open, and the diagnosis names the command that would settle it.

## Performance

Logs are usually the wrong probe. Establish a baseline measurement first (timing harness, `performance.now()`, profiler, query plan), then bisect against it. Measure first, fix second.
