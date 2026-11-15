---
name: check-feature
description: 'Walk the criteria of a finished change, and the neighbours of each seam it modified, through the running app in a browser, one screenshot each. Use when a change a user sees is verified in a browser, or the user asks what a change broke beside it.'
compatibility: Requires a container that can start the project's app, plus playwright-cli for the browser session and base-worktree
---

# Check feature

One question: does this change do what was asked, on the real screens of the running app, with the behaviour beside it still working. A video for a person is a walk of its own; a change with no screen returns `not-applicable`. It covers every criterion of the task at once: a walk before the last change goes stale with it.

## Process

1. **Criteria.** From the ticket's acceptance criteria, its user amendments, the analysis, and the full task diff against the base: one line per acceptance criterion a browser can observe. A later refactor does not retract an earlier criterion; only an explicit user scope change does. When the task diff changes scrolling layout, include page-scroll and internal-scroll states for its required actions. When it renders user data, include the worst cases the task reaches: a long value, an empty, a single and a large collection, at the real container width. Split a compound one when its parts need different evidence; an implementation detail is never a criterion. Then the neighbours: for every seam the diff modifies that existed on the base, a function, route, query, schema, shared component or config value that reads differently now, one criterion per neighbour a user can reach in the browser, found by grep: a screen that calls the changed function, reads the changed state or schema, or mounts the changed component. A seam the diff only adds has none. A control the change adds or alters also gets a keyboard criterion: Tab reaches it in visual order with a visible focus, Enter or Space works it, and a dialog it opens closes on Escape. Done when every criterion names the screen and the state that proves it.

2. **App.** Start it. Prove the checkout and claim a session: [browser.md](references/browser.md). The audit walks the screens of that app, logged in as the runbook says, through the API and the data the app has here; the sandbox is private, so "a synthetic status keeps the API and customer data out" argues for the running app, since only it shows the status arriving. A page built for the audit, whatever component it mounts, closes no criterion.

3. **Walk.** Every criterion in turn, through the device (`click`, `fill`, `press`, `page.mouse`), never a state set from `eval`. When the diff adds or changes the screen that creates a criterion's starting state, the walk creates that state on that screen first, and a state that screen cannot create is `failed`. A criterion passes on the change the page shows, never on a command reporting success. A colour is read from the element with `getComputedStyle` in `eval`, never from a cropped screenshot, whose pixels blend with antialiasing and whose crop needs a library the image lacks. Done when every criterion carries a verdict and a screenshot read against it. Verdicts:
   - `passed`
   - `failed`, with expected, actual and evidence; the walk records it and goes on to the next criterion
   - `not-implemented`
   - `coverage-gap`: no control this browser can drive
   - `unreachable`: the run stopped before it

   A neighbour's criterion that failed is walked once more on the base: `base-worktree <merge-base>` prints a detached checkout with `node_modules` and `.env` linked in; start the app from there on the port the runbook keeps for a second build and drive the same flow. A flow that works there and fails here is `regressed`; one broken there too is `pre-existing`, a finding this branch inherited.

   A required action that cannot be completed is `failed`, even if another action works. Escape does not substitute for a required close button. Missing populated sibling data is a `coverage-gap`, not a pass from component tests. Only findings outside the cumulative criteria are incidental.

4. **Report.** `browser/<run-id>/report.md`, where your seat's rules keep outputs, else where the user names, from [report.md](references/report.md), the screenshots beside it. A `passed` criterion is ticked where the task lists it, beside its screenshot path. Done when the report lists every criterion and every file it cites exists.

5. **Cleanup** as [browser.md](references/browser.md) says, the base's build included. Then end with the run's verdict and the report's absolute path.

