# Browser acceptance audit

## Criterion matrix

One matrix, two axes. Acceptance criteria come from the source; regression criteria come from the blast radius. Every criterion appears once, on one axis, with one verdict:

- `checked-in-browser`: the walkthrough observed it behaving as required.
- `covered-by-existing-test`: the test ran against this checkout; cite command, test name and result. A run carrying failures beside them names each one and its verdict on the base checkout, in the report and in the artifact it files.
- `out-of-scope-with-evidence`: cite the source or diff evidence that excludes it.
- `failed`: acceptance only; observed and wrong. Cite expected, actual and evidence.
- `not-implemented`: acceptance only; the behavior is absent. Cite what is missing.
- `regressed`: regression only; it works on the base checkout and not on this one. Cite both observations.
- `pre-existing`: regression only; it is broken on the base checkout too. Cite both observations.
- `coverage-gap`: regression only; no route a user can drive and no test covering it, so this run proves nothing about it.
- `unreachable`: a blocked run stopped before it could be observed.

Split a compound criterion when its parts need different evidence. An implementation detail is never promoted to a criterion.

## Blast radius

A **sibling** is a behavior that worked on the base branch and passes through something this diff changed. The regression axis is the siblings.

Establish the base. `gh pr view --json baseRefName` names it, and the repository's default branch stands in when no PR is open. The diff under audit is `git diff $(git merge-base <base> HEAD)..HEAD`.

Then account for every seam the diff modifies: a function, module, route, query, schema, shared component or config value that existed on the base branch and reads differently now. A seam the diff only adds has no siblings and is named as such. A seam it modifies carries one regression criterion per sibling, found by grep over the repository:

- **Callers**: every other consumer of a changed function or module.
- **Shared state**: a migration, schema or config change makes a sibling of every behavior reading that state.
- **Shared surface**: a changed component, layout or style reaches every screen that mounts it.
- **Written data**: records the new path creates that an older path later reads.

A sibling a user can reach in the browser becomes a regression criterion; one with no such route and no test covering it is a `coverage-gap`. Done: every modified seam carries either its siblings as criteria or a stated reason it has none.

## Runbook

`run.sh start` brings the application up, waits for ready and prints the URL; `run.sh stop` takes down what it started and confirms the ports fall silent. The audit starts and stops through it, and a run that fails there reports a stale runbook rather than working around it by hand. It earns its place once startup takes more than one checked-in command; a single `pnpm dev` stays in prose. `run.md` holds what `run.sh` does, the credentials source, and one line per environment workaround the script carries with the reason it is there. `features/<screen>.md` holds what a screen does, how a user reaches it, how to drive it with `playwright-cli`, and its gotchas. `gotchas.md` holds what does not take a scripted action and the workaround.

Missing runbook: read `AGENTS.md`, `CLAUDE.md`, `README`, `package.json`, `Makefile`, compose files and start from checked-in commands. A command you cannot find in the repository is a stopped audit, never a guess. Keep a scratch log for this run in `$TMPDIR`: every command with its outcome, every route, every action that failed and what worked instead.

## Maintain the runbook

Written after cleanup, so the stop commands are proven too, in English whatever language the audit was discussed in. Source is the scratch log, not memory.

- `run.sh`: `set -euo pipefail`, one argument (`start`, `stop`), the commands exactly as they ran this audit. A ready check that never confirmed is not a ready check.
- `run.md`: what `run.sh` does, the credentials source and the workaround reasons. A project still on prose keeps its start, ready check, URL and stop here.
- `features/<screen>.md`: one file per screen this run drove, with the route taken and the `playwright-cli` actions that worked. An existing file gets corrected where this run diverged; a screen this run did not touch is left alone.
- `gotchas.md`: an entry only for an action that failed this run and its workaround. A failure an entry already describes is folded into that entry, under its heading. An existing entry whose failure did not reproduce this run is deleted.
- Each markdown file stays under 150 lines; over the limit, cut the oldest entries that this run did not exercise.

The report's "Runbook changes" section names every file touched and why.

## Prove the checkout

Before startup record branch, commit, base branch, merge-base commit, `git status --porcelain` and a hash of the diff against `HEAD`. Record the launch command, process working directory and the URL that answered. A reachable URL whose process does not run from this checkout is a failed audit.

Use only test identities the runbook names or credentials the sandbox already holds. Credential values never enter a report, a screenshot or a recording.

## Browser

Load the `playwright-cli` skill before the first action: it carries the command reference this file does not repeat, at the version this image installed. A container that does not carry it is a stale image, and the run is `blocked` on it.

A config file carries what the audit depends on, so none of it rides on a command the walk has to remember: `outputDir` takes the CLI's own scratch, a snapshot file per command, into a subdirectory, leaving the run's directory to the evidence a person opens, and the viewport is a context option, so a context the CLI restarts mid-run comes back at the same size.

```json
{
  "outputDir": "<artifact-dir>/cli",
  "browser": {
    "browserName": "chromium",
    "contextOptions": { "viewport": { "width": 1920, "height": 1080 } }
  }
}
```

The image already points `PLAYWRIGHT_MCP_CONFIG` at a container-wide config, and passing your own replaces that file rather than extending it, which is why this one repeats `browserName`. Without it the CLI reaches for a branded Chrome the image does not carry.

Claim a session before the first command, so a parallel agent's browser is never the one under audit:

```bash
export PLAYWRIGHT_CLI_SESSION=to-testing-<run-id>
playwright-cli --config <artifact-dir>/cli.config.json open <url>
```

An export lasts one shell, so the session name and `NODE_NO_WARNINGS=1` go wherever the environment keeps a variable for the shells after this one.

Read `window.innerWidth` back before the first capture: a size the config did not take turns every later screenshot into evidence at the wrong resolution, silently.

Take targets from `snapshot` refs, and `find <text>` where a page is too large to snapshot whole. A `getByRole(...)` locator or a CSS selector stands in where a ref does not survive a re-render.

A covered control reports itself on the click's own output: once the command has retried to its timeout it names the element that took the event, `… intercepts pointer events`. Read that output, because it is the finding — a chat widget over a save button is a defect a user would hit, recorded against the criterion, and it exists only for as long as the stream carrying it is read. Forcing the click, or dispatching it from `eval`, sends an event the user could not have sent, so a criterion proved either way is not proved.

An action waits for itself and for nothing after it: `find`, `eval` and `screenshot` report whatever is on the page at the instant they run, which after a navigation or a mutation is a page still settling. `run-code` is where a real wait lives — `waitForURL`, `waitForSelector`, a locator's `waitFor` — so a read that follows a change goes through one and names the condition it waited for. A wall-clock guess that has to grow as the run goes on is measuring the same flake three times.

## Evidence

Evidence is a screenshot per criterion, taken at the state that decides its verdict, named `<NN>-<criterion-slug>.png` beside the report; a failed criterion gets the screenshot of the failure and, where the cause is not on screen, the console or the response that shows it, copied as text. Tracing stays off: a trace records every action with a screenshot, the page's resources and full request bodies, hundreds of megabytes a person never opens, while the screenshots and the videos below are what the report cites.

Record video for every criterion that takes more than one action: a form driven field by field, a flow crossing screens, motion, ordering, transient state. Caption it in the report with what happens, in order. Bring whatever names the subject of the action into frame first, so the recording shows which row, record or document changed. A video is a replay of the settled flow, not the walk that found it: [recording a flow](recording.md).

Screenshot a single settled state the snapshot cannot prove, naming it with a path inside the artifact directory: a bare filename lands wherever the command was run, which is the repository. Scroll that state into view and capture the whole viewport; `highlight <ref>` marks the element that matters while the rest of the screen stays readable. Each shot carries a caption in the report saying what it shows and where to look, and belongs to exactly one criterion. Full-page only when one criterion covers the whole page, with the reason in the artifact table.

Every capture is read before it is filed, because a person is the second reader of it and not the first. Open the image and hold it against the criterion: the state the criterion names is in the frame, and everything else in the frame is accounted for — an element sitting on top of another, a panel that did not close, a region that came up empty, a value that did not change. A snapshot reports the tree the page declares, so a layout that renders wrong passes it; the image is where that surfaces, and where a criterion about appearance is settled at all. What the image shows carries the same weight as any other observation: expected, actual, and this capture as the evidence. A video is read the same way, as frames, since the still is the unit an agent can look at.

This reads a rendered page, not a design: it catches an overlap, a truncation, an empty region, a control that stayed enabled, and it leaves spacing and shade against a mock to the person.

A person opens the report, not the filesystem, so its artifact list starts with the run directory itself as an absolute `file://` link and names every file relative to it: one click lands them in the folder, where the rest sit side by side.

Every capture runs at the configured Full HD unless the criterion turns on a smaller screen, which sets its own size with `resize` and names it in the artifact table.

## The walk

Walk the primary flow of every `checked-in-browser` acceptance criterion, then every regression criterion, then the risk states the diff introduces: changed validation branches, empty results, permissions, retries, destructive confirmations, loading transitions, viewport behavior. Only risks the diff supports.

A criterion passes on the change the page shows, never on a command reporting success. A criterion about an input — a drag, a click, a keystroke — passes on that input driven through the device (`page.mouse`, `click`, `fill`); a control this browser gives no way to drive makes it a `coverage-gap`, never a state set from `eval`. A criterion carries the same capture rules however many have already failed this run.

## Verdict and cleanup

A run ends one of two ways.

**Blocked** stops the audit where it stands: the checkout does not match, the application does not start, a prerequisite is missing, or a criterion on the path to others fails and puts the rest out of reach (no login, nothing behind it). Every criterion still unobserved is `unreachable` and the status is `blocked`.

**Failed** records the criterion and the walk goes on. One independent criterion failing costs this run one entry, not the rest of the matrix: a diff that breaks three siblings reports three, so a single fix cycle answers all of them. Group the failures by the seam they trace to, so one broken dependency reads as one cause with its consequences rather than a flat list of symptoms.

**Incidental** is what the walk hits outside every criterion: a console error on a route it only passed through, an identity that dead-ends, a defect on a neighbouring screen. It goes to the report's "Incidental findings" section with the route and the evidence that produced it, and it moves no verdict.

**Crashed** is the instrument, not the change. `Target crashed` empties the page, so reopen and walk the criterion again. Inside `run-code` it arrives as a script waiting out its timeout rather than as an error, so a replay that goes quiet is a crashed page. A criterion whose evidence spans the crash is walked again; one that cannot be is `unreachable`, and a crash that repeats in the same flow puts the run `blocked` on the environment.

Before a criterion is `regressed`, drive the same flow against the base checkout and record both observations. `base-worktree <merge-base>` prints the path to one: a detached worktree with every ignored path symlinked back, so it carries the `node_modules` and `.env` the application needs to start. Broken there too makes it `pre-existing`: a finding this branch inherited, not a fault it introduced.

Status is `ready-for-human-approval` when every criterion passed, `failed` when any is `failed`, `not-implemented` or `regressed`, and `blocked` when the run stopped early. A `coverage-gap` keeps the run approvable and goes to the report's "Coverage gaps" section, so the person approves knowing what this audit could not prove. Writing the test that closes a gap belongs to `tdd`, never to this audit.

Cleanup runs on every exit: `playwright-cli close`, then `run.sh stop` or the prose stop commands, then confirm with a request per port that nothing answers. The stop script's own report is not that confirmation, and a port still answering takes the surviving pid by name.

Evidence of every criterion the run observed moves in beside the report; a `blocked` run keeps the evidence of the blocker alone. `git status --porcelain` comes back as clean as the checkout proof recorded it: anything the CLI left in the working tree is removed, and the report says the output directory did not hold.

Publication, pushes and merges stay with the person. Post to Linear only when the person tells you to.
