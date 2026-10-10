# Task directory

One directory per task at `$FLEET_ARTIFACTS/$SANDBOX_NAME/`. A single repo uses `~/.fleet/tasks/<repo>/<sandbox>/`; a new multi-repository task uses `~/.fleet/tasks/groups/<repo-names>-<hash>/<sandbox>/`. The group hash comes from the sorted full GitHub repository names, not commits or argument order. Older tasks retain their recorded path or the primary repo's path when their manifest has none. `{{cli}} up` creates it, `{{cli}} down` keeps it. It carries the work between skills, between sessions and to the host: what the next reader needs is in a file here or in git. The state of the work is herdr's and git's: the agent writes no status file, and each turn ends with the closing message its container rule shows.

## Files

Each file has one role, and only the files below belong here. Git is the authority for commits, branches and dirty state; the pull request lives on GitHub. A multi-repository integration test report records every full SHA so a later reader can identify what ran.

```text
permissions.md what each seat may do in each repository: one line per action and level; {{cli}} up writes it
repositories.json  every clone's path, base, base SHA and branch for a multi-repository task; the host keeps the authoritative copy
project.md     how the primary project does what the rules require, when ~/.fleet/config/projects/<owner>/<repo>.md exists; {{cli}} up writes it
projects/      additional repos' project overlays, named by their workspace basenames, when present
ticket.md      the tracker issue this task delivers, copied at start by the host; the ticks and their evidence are the container's
analysis.md    what was found: verdict, evidence, open questions
spec.md        what will be built and why
issues/        NN-<slug>.md, one ticket per commit; a plan, ticked with evidence at its end
review.md      Review and Required fixes lines, findings, checks read, shared seams
browser/       <run-id>/report.md, a list of frames, one line each with the criterion and verdict, beside the screenshots and a walkthrough video
mockup/        index.html, the task's one board, and board.js: live pages of changes before they are built, one <slug>/ per mockup with its screenshots
logs/          sessions/, activity.jsonl, usage.json, memory.json from the agent and {{cli}} down; <skill>-<id>/ evidence
```

`runbook/`, when present at the root of `$FLEET_ARTIFACTS` beside the task directories, holds shared app-start and screen-driving instructions such as `run.sh`, `run.md`, `features/<screen>.md`, `gotchas.md` or `gate-base/<sha7>.md`.

One short file per name above `logs/`. Top-level files are current state, never an archive: update them in place when their truth changes, or delete them when they no longer have a role.

- `analysis.md` is a snapshot anchored to the analyzed commit; a later analysis replaces it
- accepted shared decisions and scope changes update `spec.md`; slice-only changes update their ticket
- `review.md` covers only its named range, and that review's findings close in its addendum. A new review replaces it, and the one it replaces moves into its `logs/review-<head-sha7>/`
- each `browser/<run-id>/report.md` records one browser run, cleanup included; a new run gets a new directory

Historical and run-specific evidence stays under `browser/` or `logs/<skill>-<id>/`, and the current top-level file points to it.

## analysis.md

Findings only: the verdict, what it rests on, what is out of scope, what is open, and the run it calls for. The decision on what to build is `spec.md`; the steps are the tickets.
