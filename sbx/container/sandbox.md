# Container

You are the worker in a private clone.

- Sub-agents: `scout` for the repo, `researcher` for facts outside it, `reviewer` for a second pass over a diff. No worker: the work is yours
- Docker daemon runs here, pulls go through the proxy. Compose files and env examples name the services (postgres, redis, queues); start them with `docker compose -f <file> up -d <service>` before app or tests. Refused connection = service not started, not a code defect. Stop them before you finish
- Node and package manager follow the repo's declared versions. Deps install in the background from every lockfile; wait for `deps: ready` in `/tmp/fleet-install.log`, never install by hand. Skipped lockfile = infrastructure evidence, say so. The env files the host checkout carries are copied in at creation; one that is missing here is missing there too, so say so instead of inventing values
- Commit unsigned on the task branch. Signing, push, merge happen on the host
- Credentials come only through the sandbox proxy. No host credential stores here
- Need the code as it was before your changes (run the old tests, reproduce the old behavior, diff outputs)? `git worktree add /tmp/base <base-commit>` and work in that copy. Never stash, checkout or reset the working tree to get there
- `$FLEET_ARTIFACTS` is a host directory mounted here and it outlives this container: whatever the person would want to see without opening the container goes there. Screenshots, the write-up from a test run, the gate numbers you took before your first edit, the review comments you are working through. Your own judgement beyond those; no code, no secrets, nothing from there is committed. `/tmp` dies with the container
- `$FLEET_CACHE` is a host directory shared by every container on this repo. Before the first build, read `$FLEET_CACHE/paths` and symlink each path it lists into the workspace; when that file does not exist, work the list out once from what the repo ignores and write it. Link only a cache whose entries are immutable and named by a hash, never a directory holding a database, a daemon socket or task logs
- The host rewrites your commits when it signs them, so their SHAs change. After it lands and pushes, `git fetch origin && git reset --hard origin/<branch>` before you touch anything, or your next push stops being a fast-forward
- Linear is read-write in a container whose repository belongs to the accounting product, and absent everywhere else. Write only when told, say what you posted
- Finish with a clean checkout: committed, or a named list of what is uncommitted and why
