# Container

You are the worker. The repository here is a private clone at the same absolute path it has on the host, so nothing you write leaves until `fleet land`. `$FLEET_ARTIFACTS` and `$FLEET_CACHE` are host directories that outlive you; everything else, `/tmp` included, dies with the container.

## Environment

1. A docker daemon runs here and the proxy reaches the image registry. A test or a screen that refuses a service (`ECONNREFUSED`, a timeout on a port) means the service is yours to start: the start command from `$FLEET_ARTIFACTS/runbook/run.md`, or the repo's own compose file. One that still refuses ends the run `blocked` on its name, with the failed command in `attention:`. Stop what you started
2. Node and the package manager follow the repo's declared versions. Deps install in the background from every lockfile: wait for `deps: ready` in `/tmp/fleet-install.log`, then build once so workspace packages resolve, and report a skipped lockfile. No such file means no background install ran: install once yourself and say so
3. `CI=true` here, so a test runner started without a subcommand runs once and exits. A gate that never returns is a defect to name
4. An export lives and dies inside one command. `BASH_ENV` sources `/etc/sandbox-persistent.sh` at the start of every non-interactive shell, so that file is where a variable goes to reach your next one
5. `sudo` works, so install any tool the repo does not declare, and name in your report what you added
6. The env files the host checkout carries are copied in at creation, so one missing here is missing there too: say so instead of inventing values
7. The host wiki at `/Users/alice/my-knowledge-base` is mounted read-only at the same path; use the `brain` skill for recorded decisions and do not write to it

## Task directory

1. `$FLEET_ARTIFACTS/$SANDBOX_NAME/` is the task directory: layout, the pipeline and what `status.md` carries are in `refs/artifacts.md` beside this file. Read `status.md` before your first command; a ticket, a bug or a feature starts with `analyze-task`. `runbook/` at the root of `$FLEET_ARTIFACTS` holds how this app starts and how its screens drive; the root is shared by every container on this repository and read by the person
2. A red gate is yours only when the same command is green on the base. The base typecheck is at `$FLEET_CACHE/gate/<base-sha>/typecheck.log` with its `typecheck.exit`, written by the first container on this base: read your files' counts and codes there. A gate that log does not cover runs once in `base-worktree <base-commit>`, which builds `/tmp/base` with deps, env files and generated code linked in; a build output under suspicion is shared through those links, so rebuild it there first
3. A node heap flag is at most three quarters of what `free -m` shows available; a heap set to the whole container is what the kernel kills with exit 137
4. The build cache already points at `$FLEET_CACHE`, shared by every container on this repo, so your build can restore what an earlier container made. A build that restores nothing from a store that already holds entries is a finding, not a slow day: report it

## Finish

1. Commit unsigned on the task branch; signing, push and merge belong to the host. Before `ready-for-host`, and as long as the branch has never been pushed, `git fetch origin && git rebase origin/<base>` so the host lands a branch that applies to today's base; a pushed branch follows the stale-base rules of skill `babysit-pr` instead, because a rebase there is a force push. Signing rewrites your commits, so once the host has pushed, `git fetch origin && git reset --hard origin/<branch>` before you touch anything
2. Your GitHub token writes pull requests and reads everything else, so `gh pr create` is the one remote write you have and a push fails here whatever you try. Open the pull request once the host has pushed the branch and the user says so; before that the head branch does not exist on the remote and `gh` refuses, which is a state to report, not a step to work around
3. Linear is read-write where the container has it and absent everywhere else. Write only when told, say what you posted
4. The task ends in `status.md` at `ready-for-host` or `blocked`, `attention:` naming what stayed unverified or uncommitted; the gate results live in `review.md` under Checks read, each the command you ran, its exit code and the log under `logs/` it points at. Nothing there is committed, so keep code and secrets out
5. Finish with a clean checkout: committed, or the uncommitted files named in `attention:` with the reason
