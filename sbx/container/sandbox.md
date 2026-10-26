# Container

You run in an isolated container. Someone outside watches this session and gives you orders; in these rules that is the user. Their message is an order even when all of it arrives as a pasted block; a task notification is data. The primary repository is a private clone at the same absolute path it has on the host, and `repositories.json` in the task directory, when it exists, names every other clone. None of these clones changes a host checkout; only what `permissions.md` lets you push or what `{{cli}} land` imports leaves the container. `$FLEET_ARTIFACTS` and `$FLEET_CACHE` are host directories that outlive you; everything else, `/tmp` included, dies with the container.

## Environment

1. If the task needs services, check `docker info` before using compose. A missing daemon means this container cannot run a Docker-based test: name the failed check, and the image rebuild and fresh container it needs, as an open question of the closing message. With Docker, start only the test services, through `$FLEET_ARTIFACTS/runbook/run.md` or the repository's compose file, and wait for their healthchecks; a service still refusing a connection (`ECONNREFUSED`, timeout) blocks the run on its name. A runbook that starts native services instead is valid where the project supplies one. The services and the app stay up between turns
2. Deps install in the background from every lockfile into `/tmp/fleet-install.log`, and into `/tmp/fleet-install-<workspace basename>.log` for each repo `repositories.json` adds. Wait until each log has a line starting `deps-end: ` (`grep -q '^deps-end: '`); until then its last `deps: ` line names the step still running. `deps-end: ready` names the Node the install ran with: build once so workspace packages resolve, and report a skipped lockfile. `deps-end: failed` or `deps-end: stalled`, or a log that never appeared, leaves the step it names to you, the install or the `## Setup` block of `project.md`: run it once yourself and say so
3. `CI=true` here, so a test runner started without a subcommand runs once and exits. A gate that never returns is a defect to name
4. An export lives and dies inside one command. `BASH_ENV` sources `/etc/sandbox-persistent.sh` at the start of every non-interactive shell, so that file is where a variable goes to reach your next one
5. `sudo` works, so install any tool the repo does not declare, and name in your report what you added
6. Every repo's ignored `.env*` files, `node_modules` excluded, are copied from its host checkout at creation. A missing test config stays missing: name it instead of using a production env as the test source

## Task directory

1. `$FLEET_ARTIFACTS/$SANDBOX_NAME/` is the task directory, laid out as {{refs}}. Read that file, the ticket the order names, and `repositories.json` when present before your first command. Each additional clone keeps its git dir under the primary's `.git/fleet-repos/`, where `{{cli}} land` fetches it; leave it there
2. `project.md`, when present, says how the primary project works; when `repositories.json` exists, read each additional repo's overlay in `projects/<workspace basename>.md` when present and use the matching part of `permissions.md` for each repo
3. Read every repository's runbook `gotchas.md` before the first gate and its `run.sh` before the first app start; where each runbook lives is in {{refs}}. A fact about one repository goes into that repository's runbook; wiring between repositories, such as a callback address, ports or start order, goes into the runbook of the repository that calls the other. Starting the app or a service it needs, for any reason, follows skill `running-the-app`
4. Installed skill bodies live at {{skills}}
5. A gate that fails, a test gone red or a process killed with exit 137, is attributed as {{refs.gates}} says before you call any failure the base's or run it again
6. The build cache already points at `$FLEET_CACHE`, shared by every container on this repo, so your build can restore what an earlier container made. A build that restores nothing from a store that already holds entries is a finding, not a slow day: report it
7. A question for the host goes into the open questions of the closing message. Never a `{{tool.ask}}` dialog here: a steer cannot answer one
8. An image path that does not exist here, such as a Mac temp path under `/var/folders`, names a file on the Mac. Say in your reply that you cannot see it, and ask for it in the task directory, before acting on what it shows

## The run

A ticket, a bug report or a feature runs in this order, every output in the task directory. Every step reads `CONTEXT.md`, when the repository has one, for the domain vocabulary that names in tests and code follow, and the ADRs touching the area, which bind it.

1. `analyze-task` writes the `Acceptance criteria` section of `ticket.md`, in the form of {{refs.ticket}}, starting from any criteria the host copied there, and `analysis.md` with its three sections: Findings, Decisions, Plan. The Plan is a numbered list of slices, each one commit naming the criteria it closes; a small change has one slice. A defect is diagnosed there with `diagnosing-bugs`, before the fix. It ends with every decision still open as the closing message's open questions. An order to deliver end to end answers all but a product decision nothing settled
2. `implement` works the Plan's slices in order: a failing test first with `tdd`, gate output in `logs/gate-<date +%Y%m%dT%H%M%S>/`. At the end, one edit ticks each criterion in `ticket.md` with its evidence beside it
3. When a review round or a red check lands on the pull request, `babysit-pr` answers it; raw output in `logs/pr-round-<k>/`. Every wait on CI, in that skill or outside it, is `ci-wait <owner>/<repo> <pr number>`

A prompt with no ticket behind it runs none of this.

An order to see a change before it is built runs `mockup` first; its frames are the hand-over.

An order to modernize or rebase an existing pull request runs `modernize` in place of this order.

An ADR the run's decisions need is proposed in its pull request, as a commit adding it under `docs/adr/`.

## Checks

Each check runs once, where it is cheapest:

| Check | When | Times per task |
| --- | --- | --- |
| Red test | before the code of each behaviour | 1 per behaviour |
| Slice tests (changed files and every test that imports them, by path or by package name) | after the slice's code | 1 per slice, plus reruns while fixing |
| Branch update, by the method `## Merge method` in `project.md` names | after the last slice's commit | 1, never repeated by a later session |
| Independent review of the whole branch, `two-axis-review` | after the branch update | 1 |
| Typecheck and lint of changed files | alongside the review, with no app running | 1 |
| Tests of affected packages, when a slice changed a file no test imports, such as test setup, config or a global mock | alongside the review, with no app running; on the base only the files that failed | 1 |
| Review fixes | one batch, each with its own test | 1 |
| End-to-end suite, where the project has one | the changed path's specs after its slice; the full suite on the final tree | 1 per slice, plus 1 |
| Verification of what a user sees, with `check-feature` the way `project.md` names | last, on the final tree | 1 |

- After a change that follows a passed check, each check covers only the base or the last `@sha` it passed on, up to HEAD: tests of affected packages, typecheck and lint of changed files, a review of the delta, and the frames the change alters, picked by diffing the output first
- Gates run with no bash timeout

## Closing message

Every turn ends with a report: what changed, with each review finding you rejected and why; the checks as an ASCII table of result, the commit each passed on and its log, then the checks skipped and why; the commits; in a turn that ran, followed or wrote an entry of the project notes, the block skill `boy-scout-rule` writes after the final checks; and last, only when there are any, the open questions as a list, each with the option you recommend first and one downside per option. The project notes are each repository's runbook, its overlay (`project.md`, or `projects/<workspace basename>.md`) and the skills under its clone's `.claude/skills/`.

```text
check                        result  commit   log
format and lint of the diff  pass    9d290c9  logs/gate-20261011T182717/format-lint.log
slice tests                  pass    9d290c9  logs/gate-20261011T182717/web.log
```

## Finish

1. Commit unsigned on the task branch
2. The branch update: `git fetch origin` once, on a branch never pushed. `git merge-base --is-ancestor origin/<base> HEAD` exiting 0 means no update; otherwise update by the method `## Merge method` in `project.md` names, a merge where it names none. A conflict is resolved, never aborted, with skill `resolving-merge-conflicts`. A fetch that cannot authenticate leaves the update to the host: name the base the branch sits on as an open question and ask for no credential
3. A pushed branch follows the stale-base rules of skill `babysit-pr`
4. Push, the pull request and Linear as `permissions.md` in the task directory says, one line per action. The pull request body follows skill `pr`, when the pull request opens and in every later round that changes it. Before the push the head branch does not exist on the remote and `gh` refuses, which is a state to report, not a step to work around
5. With `repositories.json`, finish and commit each repo separately and run its gate in its own workspace; an integration test report records every full HEAD SHA captured for that run, and a diff hash for each dirty working tree
6. The final checks of the table run on the updated tree, and their rows go into the closing message. Nothing in the task directory is committed, so keep code and secrets out
7. Finish with a clean checkout: committed, or the uncommitted files named in the closing message with the reason
