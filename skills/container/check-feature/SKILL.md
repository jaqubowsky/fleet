---
name: check-feature
description: 'Walk the acceptance criteria of a finished change through the running app in the browser, one screenshot per criterion. Use after review, before the change is handed over, whenever the change reaches a screen.'
compatibility: Requires a container that can start the project's app, plus playwright-cli for the browser session
---

# Check feature

One question: does this change do what was asked, on the real screens of the running app. Regressions in neighbouring behaviour are `check-regressions`; a video for a person is `record-walkthrough`; a change with no screen returns `not-applicable`.

## Process

1. **Criteria.** From `analysis.md`, `spec.md`, the tickets under `issues/` and the diff against the base: one line per acceptance criterion a browser can observe. Split a compound one when its parts need different evidence; an implementation detail is never a criterion. In `status.md`, `status: testing`. Done when every criterion names the screen and the state that proves it.

2. **App.** Start it with the runbook's command (`$FLEET_ARTIFACTS/runbook/run.md`, `run.sh start`), or the repository's own script when there is no runbook. Prove the checkout and claim a session: [browser.md](references/browser.md). The audit walks the screens of that app, logged in as the runbook says, through the API and the data the app has here; the sandbox is private, so "a synthetic status keeps the API and customer data out" argues for the running app, since only it shows the status arriving. A page built for the audit, whatever component it mounts, closes no criterion. An app that does not start ends the run `blocked` on the named service, with the failed command in `attention:`.

3. **Walk.** Every criterion in turn, through the device (`click`, `fill`, `page.mouse`), never a state set from `eval`. A criterion passes on the change the page shows, never on a command reporting success. Verdicts: `passed`, `failed` (expected, actual, evidence), `not-implemented`, `coverage-gap` (no control this browser can drive), `unreachable` (a blocked run stopped before it). A failed criterion is recorded and the walk goes on; only `blocked` stops it. Done when every criterion carries a verdict and a screenshot read against it.

4. **Report.** `$FLEET_ARTIFACTS/$SANDBOX_NAME/browser/<run-id>/report.md` from [report.md](references/report.md), the screenshots beside it. Runbook files touched are named in it. Done when the report lists every criterion and every file it cites exists.

5. **Cleanup and status.** `playwright-cli close`, `run.sh stop`, a request per port to confirm silence, `git status --porcelain` as clean as the checkout proof. In `status.md`: the log line `browser <run-id>: <passed | failed n | blocked>; browser/<run-id>/report.md`; `status: ready-for-host` when every criterion passed, `implementing` with `now:` on the first failed criterion, `blocked` with an `attention` line. Then print the report in full with absolute paths and end with the run's status.

## After it

`check-regressions` runs when `review.md` names a shared seam (a component, hook, query or endpoint the diff changed and other screens use) or the user asks. `record-walkthrough` runs on the user's word, once this audit passed.
