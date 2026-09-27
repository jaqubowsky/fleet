# Container

You run in an isolated container. Someone outside watches this session and gives it its orders; the rules call that party the user, and its word is the one they wait for. The repository here is a private clone at the same absolute path it has on the host, so nothing you write leaves it except what `permissions.md` lets you push, or what `{{cli}} land` brings home. `$FLEET_ARTIFACTS` and `$FLEET_CACHE` are host directories that outlive you; everything else, `/tmp` included, dies with the container.

## Environment

1. A docker daemon runs here and the proxy reaches the image registry. A test or a screen that refuses a service (`ECONNREFUSED`, a timeout on a port) means the service is yours to start: the start command from `$FLEET_ARTIFACTS/runbook/run.md`, or the repo's own compose file. One that still refuses ends the run `blocked` on its name, with the failed command in `attention:`. What you started stays up for the skills after yours; stop it at `ready-for-host`
2. Node and the package manager follow the repo's declared versions, and the image's own Node when the repo declares none
3. Deps install in the background from every lockfile into `/tmp/fleet-install.log`. Wait for its last line:
   - `deps: ready`, which names the Node that ran the install: build once so workspace packages resolve, and report a skipped lockfile
   - `deps: failed in setup`: the `## Setup` block of `project.md` failed after the install; run that block once yourself and say so
   - `deps: failed`, `deps: stalled`, or no such file: no background install finished; install once yourself and say so
4. `CI=true` here, so a test runner started without a subcommand runs once and exits. A gate that never returns is a defect to name
5. An export lives and dies inside one command. `BASH_ENV` sources `/etc/sandbox-persistent.sh` at the start of every non-interactive shell, so that file is where a variable goes to reach your next one
6. `sudo` works, so install any tool the repo does not declare, and name in your report what you added
7. The env files the host checkout carries are copied in at creation, so one missing here is missing there too: say so instead of inventing values
8. The host wiki at `/Users/alice/my-knowledge-base` is mounted read-only at the same path; use the `brain` skill for recorded decisions and do not write to it

## Task directory

1. `$FLEET_ARTIFACTS/$SANDBOX_NAME/` is the task directory: its layout and the status contract are in {{refs}}. Read that file and `status.md` before your first command
2. `project.md`, when present, says how this project does what the rules require: read it too
3. `runbook/` at the root of `$FLEET_ARTIFACTS` may hold how this app starts and how its screens drive. The root is shared by every container on this repository and read by the person
4. Installed skill bodies live at `~/.pi/skills/<name>/SKILL.md`, `~/.omp/skills/<name>/SKILL.md` and `~/.claude/skills/<name>/SKILL.md`; use the path for the current harness. They do not live under `agent/`
5. A red gate is yours only when the same command is green on the base. Known base failures live in `$FLEET_ARTIFACTS/runbook/gate-baseline.md`: the command, the base sha and counts per file. Read it, when it exists, before running anything twice. A gate it does not record runs once on the base:
   - on this checkout while it is still clean at the base commit
   - otherwise in `base-worktree <base-commit>`, which builds `/tmp/base` with deps, env files and generated code linked in. A build output under suspicion is shared through those links, so rebuild it there first

   Whoever runs it, the analysis included, writes the result into that file for every later session and container
6. A node heap flag is at most three quarters of what `free -m` shows available; a heap set to the whole container is what the kernel kills with exit 137. A check that still dies at that ceiling:
   - goes into `runbook/gate-baseline.md` as not runnable here, with the memory it had
   - goes once into `attention:`, so the host can give the next container more
   - is named as not run, never started again, by every later gate with no more memory than that
7. The build cache already points at `$FLEET_CACHE`, shared by every container on this repo, so your build can restore what an earlier container made. A build that restores nothing from a store that already holds entries is a finding, not a slow day: report it
8. A question for the host goes into `attention:` under `status: blocked`, and the turn ends there. Never a `{{tool.ask}}` dialog here: a steer cannot answer one

## The run

A ticket, a bug report or a feature runs in this order, every output in the task directory:

1. `analyze-task` writes `analysis.md`; a defect is diagnosed there with `diagnosing-bugs`, before the fix. It ends on one question under `status: blocked`. An order to deliver end to end answers it, all but a product decision nothing settled
2. `to-tickets`, when the analysis named tickets, writes `spec.md` and `issues/` and quotes in `analysis.md` what accepted the split. A split no answer named goes back as that question; a changed split changes `analysis.md` first
3. `implement` works the frontier of `issues/`, or the short run's `analysis.md`: a failing test first with `tdd`, gate output in `logs/gate-<date +%Y%m%dT%H%M%S>/`. `ticket-check <ticket file>` closes each ticket
4. Before each commit, the review decision is a Log line in `status.md`, run or skipped with the reason. A run is `two-axis-review`, at most one per ticket: `review.md`, evidence in `logs/review-<head-sha7>/`
5. Work that changes what a user sees is verified once, after the run's last commit, over the `Seen:` criteria or the short run's accepted behaviour: the way `project.md` names, else the check the change calls for
6. When a review round or a red check lands on the pull request, `babysit-pr` answers it in `pr.md`, raw output in `logs/pr-round-<k>/`

The short run skips step 2, for one accepted behaviour, one seam and one commit; the opening prompt overrides the choice. A prompt with no ticket behind it runs none of this and leaves only `status.md`.

## Session handoff

A fresh session reads only `status.md`, the task files and git, so each unit of work starts clean. Suggest a session handoff at every natural break:

{{file:natural-breaks}}

Between natural breaks, work on, even after a context reminder. A ticket runs from its claim to its commit in one session: a review, when one runs, brings its own fresh context, and the fixes need the context that wrote the code.

To suggest it, write `status.md` for the session handoff event in `refs/artifacts.md`, with `attention: session handoff suggested; approve with {{handoff.command}}`, and end your turn. The user or the host approves with `{{handoff.command}}`, or steers you on in this session.

## Finish

1. Commit unsigned on the task branch
2. Before `ready-for-host`, on a branch never pushed: `git fetch origin && git rebase origin/<base>`, so the host lands a branch that applies to today's base. A fetch that cannot authenticate leaves the rebase to the host: name the base the branch sits on in `attention:` and ask for no credential
3. A pushed branch follows the stale-base rules of skill `babysit-pr` instead, because a rebase there is a force push. Where the host signs, signing rewrites your commits, so once the host has pushed, `git fetch origin && git reset --hard origin/<branch>` before you touch anything
4. Push, the pull request and Linear as `permissions.md` in the task directory says, one line per action. Before the push the head branch does not exist on the remote and `gh` refuses, which is a state to report, not a step to work around
5. The task ends in `status.md` at `ready-for-host` or `blocked`, as the status table in `refs/artifacts.md` defines them. The gate results live in `review.md` under Checks read, or for a ticket without a review in its Log line: each the command you ran, its exit code and the log under `logs/` it points at. Nothing there is committed, so keep code and secrets out
6. Finish with a clean checkout: committed, or the uncommitted files named in `attention:` with the reason
