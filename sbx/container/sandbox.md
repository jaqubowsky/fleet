# Container

You are the worker. The repository here is a private clone at the same absolute path it has on the host, so nothing you write leaves until `fleet land`. `$FLEET_ARTIFACTS` and `$FLEET_CACHE` are host directories that outlive you; everything else, `/tmp` included, dies with the container.

## Environment

1. A docker daemon runs here and the proxy reaches the image registry: the repo's own compose file brings up the services its tests need. Stop what you started; a refused pull or connection is reported by service name, then the step ends. An application that cannot come up for want of a service, a database or an env file ends the run `blocked` on the named missing piece; moving the run to the host is the user's call
2. Node and the package manager follow the repo's declared versions. Deps install in the background from every lockfile: wait for `deps: ready` in `/tmp/fleet-install.log`, then build once so workspace packages resolve, and report a skipped lockfile. No such file means no background install ran: install once yourself and say so
3. `CI=true` here, so a test runner started without a subcommand runs once and exits. A gate that never returns is a defect to name
4. An export lives and dies inside one command. `BASH_ENV` sources `/etc/sandbox-persistent.sh` at the start of every non-interactive shell, so that file is where a variable goes to reach your next one
5. `sudo` works, so install any tool the repo does not declare, and name in your report what you added
6. The env files the host checkout carries are copied in at creation, so one missing here is missing there too: say so instead of inventing values
7. The host wiki at `/Users/alice/my-knowledge-base` is mounted read-only at the same path; use the `brain` skill for recorded decisions and do not write to it

## Evidence

1. Before your first measurement: `ls "$FLEET_ARTIFACTS"` and read what is there. Every container on this repository shares it, the person reads it too, and `runbook/` at its root holds how this app starts and how its screens drive
2. A red gate is yours only when the same command is green on the base commit: `base-worktree <base-commit>` builds `/tmp/base` with deps, env files and generated code linked in, and prints its path; run the command there. Those links make one file serve both trees, so a build output under suspicion is shared: rebuild it in `/tmp/base` before the comparison decides anything. That worktree is also how you read the code as it was
3. The build cache already points at `$FLEET_CACHE`, shared by every container on this repo, so your build can restore what an earlier container made. A build that restores nothing from a store that already holds entries is a finding, not a slow day: report it

## Finish

1. Commit unsigned on the task branch; signing, push and merge belong to the host. Signing rewrites those commits, so once the host has pushed, `git fetch origin && git reset --hard origin/<branch>` before you touch anything
2. Linear is read-write where the container has it and absent everywhere else. Write only when told, say what you posted
3. Your report stands on `$FLEET_ARTIFACTS/$SANDBOX_NAME/`: the gate results, each one the command you ran and the name of every failure it reported, plus every screenshot and write-up it cites. Nothing there is committed, so keep code and secrets out
4. Finish with a clean checkout: committed, or a named list of what is uncommitted and why
