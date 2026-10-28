# Gate failures

Reached from the container rules when a gate fails: a test goes red, or a process dies; and when a task needs services.

## Whose failure it is

Attribute each failure by name: it is the base's only when that same test fails on a finished base run with the same command, config, lockfile and generated inputs. A red base never covers a new failure, even at an equal count. A run that did not finish, or ran on other inputs, is unverified.

`runbook/gate-base/<base sha7>.md` holds that commit's results, one line per command: exit code, failing tests by name, counts per file, log path. A line counts for the same command and inputs, and on a later base commit whose changes touch no file the failing test imports, directly or not. A failure the container causes rather than the code, failing the same way on two base commits with its cause named, such as a service or memory this image lacks, goes into `runbook/gate-base/container-<image stamp sha7>-<lockfile sha7>.md`, the stamp read from `logs/image-stamp` and the lockfile hashed with `git hash-object`; while both match, it counts as the base's on any base commit.

A failure neither file lists runs on the base as that failing test file alone, with the same command; a whole suite there repeats the full pass to learn one fact:

- on this checkout while it is still clean at the base commit
- otherwise in `base-worktree <base-commit>`, which builds `/tmp/base` with deps and env files linked in. Generated code and build output stay the base's own: generate and build there the way the runbook does before the run

Whoever runs it, the analysis included, adds its line to that file for every later session and container on the same base.

## A process killed with exit 137

The kernel killed it for memory. A node heap flag is at most three quarters of what `free -m` shows available once everything else the task started, the app included, is stopped; a heap set to the whole container is what the kernel kills. A check that still dies at that ceiling:

- goes into `runbook/gotchas.md` as not runnable here, with the memory it had
- goes once into the closing message's open questions, so the next container can get more
- is named as not run, never started again, by every later gate with no more memory than that

## Services

A missing Docker daemon: name the failed `docker info` check, and the image rebuild and fresh container it needs, as an open question of the closing message.

With Docker, start only the test services, through `$FLEET_ARTIFACTS/runbook/run.md` or the repository's compose file, and wait for their healthchecks; a service still refusing a connection (`ECONNREFUSED`, timeout) blocks the run on its name. A runbook that starts native services instead is valid where the project supplies one. The services and the app stay up between turns.
