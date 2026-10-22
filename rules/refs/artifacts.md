# Task directory

One directory per task at `$FLEET_ARTIFACTS/$SANDBOX_NAME/`. A task uses `~/.fleet/tasks/<primary repo>/<sandbox>/`, for one repository or several. `{{cli}} up` creates it, `{{cli}} down` keeps it. It carries the work between skills, between sessions and to the host: what the next reader needs is in a file here or in git. The state of the work is herdr's and git's: the agent writes no status file, and each turn ends with the closing message its container rule shows.

## Files

Every task has the same files, built the same way, and only these. Git is the authority for commits, branches and dirty state; the pull request lives on GitHub. A multi-repository integration test report records every full SHA so a later reader can identify what ran.

```text
permissions.md what each seat may do in each repository: one line per action and level; {{cli}} up writes it
repositories.json  every clone's path, base, base SHA and branch for a multi-repository task; the host keeps the authoritative copy
project.md     how the primary project does what the rules require, when ~/.fleet/config/projects/<owner>/<repo>.md exists; {{cli}} up writes it
projects/      additional repos' project overlays, named by their workspace basenames, when present
ticket.md      the host's requirement, copied at start, then the Acceptance criteria the analysis writes; each criterion ticked with its evidence at the end
analysis.md    Findings, Decisions, Plan
review.md      the one review of the whole branch: Review and Required fixes lines, findings, checks read, shared seams
browser/       <run-id>/report.md, a list of frames, one line each with the criterion and verdict, beside the screenshots and a walkthrough video; scripts/, the login, seed and walk scripts every run reuses
mockup/        on an order for one: index.html, the task's one board, and board.js: live pages of changes before they are built, one <slug>/ per mockup with its screenshots
logs/          sessions/, activity.jsonl, usage.json, memory.json from the agent and {{cli}} down; image-stamp, the harness commit the container image was built from, from {{cli}} up; <skill>-<id>/ evidence
```

`runbook/`, when present at the root of `$FLEET_ARTIFACTS` beside the task directories, is the primary repository's shared app-start and screen-driving instructions. Each other repository of the task has its own at `$FLEET_ARTIFACTS/../<repo>/runbook`. Every task on that repository reads it before it starts, so it holds rules, and the run that found a rule keeps the record of finding it:

- a fact goes where its scope is: starting the app in `run.sh` and `run.md`, one screen in `features/<screen>.md`, what defies a reasonable assumption about the environment, such as a gate that dies or flakes there or an action no script takes, in `gotchas.md`
- each entry states today's design: the symptom, the cause, the fix or the command. Dates, ticket ids, commit SHAs, counts and log paths stay in the task's `logs/` and closing message
- one entry per cause: search the runbook first, and edit the entry the fact belongs to

`gate-base/` holds the one kind of record there, in the form {{refs.gates}} gives it: `<sha7>.md` for one commit's gate results, `container-<stamp>-<lockfile>.md` for the failures the container itself causes.

One short file per name above `logs/`. Top-level files are current state, never an archive: update them in place when their truth changes, or delete them when they no longer have a role.

- the Findings of `analysis.md` are anchored to the analyzed commit; its Decisions and Plan change in place
- a changed requirement updates the criteria in `ticket.md`, and a changed decision Decisions in `analysis.md`, before the code changes
- `review.md` covers only its named range, and that review's findings close in its addendum. Before a new review writes `review.md`, the one it replaces moves into its `logs/review-<head-sha7>/`
- each `browser/<run-id>/report.md` records one browser run, cleanup included; a new run gets a new directory

Historical and run-specific evidence stays under `browser/` or `logs/<skill>-<id>/`, and the current top-level file points to it.
