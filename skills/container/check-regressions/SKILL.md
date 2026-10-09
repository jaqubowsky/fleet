---
name: check-regressions
description: 'Check the behaviours beside a change, the callers and readers of each seam the diff modified, on this checkout, and on the base only for one that fails. Use when the task''s diff changes a shared seam, or the user asks what a change broke beside it.'
compatibility: Requires a container that can start the project's app, plus playwright-cli and base-worktree
---

# Check regressions

One question: did this change break a behaviour that worked on the base. A browser walk has already proved the change itself; this skill proves its neighbours, and costs a base checkout and a second walk.

A **sibling** is a behaviour that worked on the base branch and passes through something this diff changed.

## Process

1. **Seams.** The diff is `git diff $(git merge-base <base> HEAD)..HEAD`. Every seam it modifies (a function, module, route, query, schema, shared component, config value that existed on the base and reads differently now) gets its siblings, found by grep: callers of a changed function, every reader of changed state or schema, every screen that mounts a changed component, every reader of data a new path writes. A seam the diff only adds has no siblings. Done when every modified seam lists its siblings or the reason it has none.

2. **Criteria.** One per sibling a user can reach in the browser. A sibling with no such route, such as a backend reader, runs through its lowest existing test instead. With neither, it is a `coverage-gap`, written down and not walked, and the run cannot pass while it stands.

3. **App and walk.** Start the app and claim a session as [browser.md](../check-feature/references/browser.md) says; walk every criterion on this checkout, one screenshot each.

4. **Base.** For every criterion that failed, `base-worktree <merge-base>` prints a detached checkout with `node_modules` and `.env` linked in; start the app from there on the port the runbook keeps for a second build and drive the same flow. Works there and fails here: `regressed`. Broken there too: `pre-existing`, a finding this branch inherited. Both observations go into the report. Done when every failed criterion has its base observation.

5. **Report and cleanup.** Write the report from [report.md](../check-feature/references/report.md), with the `Seam` column, to `browser/<run-id>/report.md` where the feature walk's report goes, then clean up both builds. A `coverage-gap` keeps the run `blocked` and stays in the report, so the person decides knowing what this run could not prove; the test that closes it is a follow-up.
