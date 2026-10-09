# Browser session

Shared by every browser walk and replay.

## Prove the checkout

Before startup record branch, full commit SHA, base branch, merge-base commit, `git status --porcelain` and a hash of the diff against `HEAD`. When `repositories.json` exists, do this in every listed workspace and pin each repository's name and full commit SHA in the report before starting services; a dirty tree needs its diff hash too. Name the test configuration for every service this run uses. If any service would fall back to a production env, stop rather than call that an automated test. Record the launch command, its working directory and the URL that answered. A reachable URL whose process does not run from these checkouts is a failed audit.

Use only test identities the runbook names or credentials the sandbox already holds. Credential values never enter a report or a screenshot.

## Session

Load the `playwright-cli` skill before the first action: it carries the command reference at the version this image installed. A container without it is a stale image, and the run is `blocked` on it. This file and the ticket set the viewport and require real UI actions; the skill's generic defaults yield to them. Read results through `--raw`, which prints only the value, and `snapshot <target>` scoped to the element in question.

A config file carries what the run depends on: `outputDir` takes the CLI's own scratch into a subdirectory, and the viewport is a context option, so a context the CLI restarts mid-run comes back at the same size. The image points `PLAYWRIGHT_MCP_CONFIG` at a container-wide config, and passing your own replaces that file, which is why this one repeats `browserName`:

```json
{
  "outputDir": "<run-dir>/cli",
  "browser": {
    "browserName": "chromium",
    "contextOptions": { "viewport": { "width": 1920, "height": 1080 } }
  }
}
```

Claim a session before the first command, so a parallel agent's browser is never the one under audit:

```bash
export PLAYWRIGHT_CLI_SESSION=browser-<run-id>
playwright-cli --config <run-dir>/cli.config.json open <url>
```

An export lasts one shell: the session name and `NODE_NO_WARNINGS=1` go into `/etc/sandbox-persistent.sh`. Read `window.innerWidth` back before the first capture; a size the config did not take makes every later screenshot evidence at the wrong resolution.

## Driving

Targets come from `snapshot` refs, or `find <text>` where a page is too large to snapshot whole; a `getByRole(...)` locator stands in where a ref does not survive a re-render.

A covered control reports itself on the click's own output: after the retries it names the element that took the event, `… intercepts pointer events`. That output is the finding (a chat widget over a save button is a defect a user would hit), and it exists only while the stream is read. A forced click or an event dispatched from `eval` proves nothing.

An action waits for itself and for nothing after it: `find`, `eval` and `screenshot` show the page at the instant they run, which after a navigation is a page still settling. A real wait lives in `run-code` (`waitForURL`, `waitForSelector`, a locator's `waitFor`), so a read that follows a change goes through one and names the condition. A `sleep` that has to grow as the run goes on is the same flake measured three times. Every page gives an action 5 s and a navigation 30 s, `run-code` included; a wait that needs longer passes its own `timeout`, and a check that something is absent uses `count()`, which does not wait.

`Target crashed` empties the page: reopen and walk the criterion again. Inside `run-code` it arrives as a script waiting out its timeout, so a replay that goes quiet is a crashed page. A crash that repeats in the same flow puts the run `blocked` on the environment.

## Evidence

One screenshot per criterion, at the state that decides its verdict, `<NN>-<criterion-slug>.png` in the run directory, the path absolute (a bare filename lands in the working directory, which is the repository). Scroll the state into view, `highlight <ref>` the element that matters, capture the viewport; full page only when one criterion covers the whole page. A failed criterion adds the console or the response that shows the cause, as text. Tracing and video stay off here: a trace is hundreds of megabytes nobody opens, and a video is a replay of its own, after the walk.

Every capture is read by the agent that took it, before it is filed: the state the criterion names is in the frame, and everything else in the frame is accounted for, an element on top of another, a panel that did not close, a region that came up empty. A snapshot reports the tree the page declares, so a layout that renders wrong passes it; the image is where that surfaces. Full HD unless the criterion turns on a smaller screen, which sets its own size with `resize` and says so in the report.

## Runbook

`features/<screen>.md` holds how a screen is reached and driven.

After cleanup, from the scratch log of this run and not from memory, in English: a screen this run drove gets its `features/<screen>.md` corrected where the run diverged; an action that failed this run and its workaround goes into `gotchas.md`. The report names every runbook file touched.

## Cleanup

`playwright-cli close`, then the app stops the way it was started. The lines this run added to `/etc/sandbox-persistent.sh` come out. `git status --porcelain` comes back as clean as the checkout proof recorded it in every repository, and a multi-repository report still names the complete set of SHAs that actually ran. Publication, pushes and merges stay with the person.
