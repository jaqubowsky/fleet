# Container

You run in an isolated container. Someone outside watches this session and gives you orders; in these rules that is the user. The primary repository is a private clone at the same absolute path it has on the host. If `repositories.json` exists in the task directory, it names every private clone at its `workspace` path. None of these clones changes a host checkout; only what `permissions.md` lets you push or what `{{cli}} land` imports leaves the container. `$FLEET_ARTIFACTS` and `$FLEET_CACHE` are host directories that outlive you; everything else, `/tmp` included, dies with the container.

## Environment

1. If the task needs services, check `docker info` before using compose. The Docker-enabled image starts an inner daemon; a missing daemon means this container cannot run a Docker-based test. Name the failed check and the needed image rebuild and fresh container in `Question:` of the closing message. With Docker available, start only the test services through `$FLEET_ARTIFACTS/runbook/run.md` or the repository's compose file and wait for their healthchecks. A service still refusing a connection (`ECONNREFUSED`, timeout) blocks the run on its name. Stop the services before the last closing message of the run and verify the ports are closed; a native-service runbook is valid when the project explicitly supplies one
2. Node and the package manager follow the repo's declared versions, and the image's own Node when the repo declares none
3. Deps install in the background from every lockfile into `/tmp/fleet-install.log` for the primary repo. When `repositories.json` exists, every additional repo has `/tmp/fleet-install-<workspace basename>.log`; check each. Wait for each log's last line:
   - `deps: ready`, which names the Node that ran the install: build once so workspace packages resolve, and report a skipped lockfile
   - `deps: failed in setup`: the `## Setup` block of `project.md` failed after the install; run that block once yourself and say so
   - `deps: failed`, `deps: stalled`, or no such file: no background install finished; install once yourself and say so
4. `CI=true` here, so a test runner started without a subcommand runs once and exits. A gate that never returns is a defect to name
5. An export lives and dies inside one command. `BASH_ENV` sources `/etc/sandbox-persistent.sh` at the start of every non-interactive shell, so that file is where a variable goes to reach your next one
6. `sudo` works, so install any tool the repo does not declare, and name in your report what you added
7. Every repo's ignored `.env*` files, `node_modules` excluded, are copied from its host checkout at creation. A missing test config stays missing: name it instead of using a production env as the test source

## Task directory

1. `$FLEET_ARTIFACTS/$SANDBOX_NAME/` is the task directory: its layout is in {{refs}}. Read that file, the ticket the order names, and `repositories.json` when present before your first command. The manifest names each clone's path, base SHA and branch; the host keeps its own authoritative copy. Each additional clone keeps its git dir under the primary's `.git/fleet-repos/`, where `{{cli}} land` fetches it; leave it there
2. `project.md`, when present, says how the primary project works; when `repositories.json` exists, read each additional repo's overlay in `projects/<workspace basename>.md` when present and use the matching part of `permissions.md` for each repo
3. `runbook/` at the root of `$FLEET_ARTIFACTS` holds how this app starts and how its screens drive. The root is shared by tasks for the same repository set and read by the person; a new multi-repository task has its own group root, not the first repo's runbook. Starting the app or a service it needs, for any reason, follows skill `running-the-app`. `gotchas.md` there holds what defies a reasonable assumption about this environment: a gate that dies or flakes here, an action no script takes. A new entry folds into one that describes it; an entry whose failure did not reproduce is deleted
4. Installed skill bodies live at `~/.pi/skills/<name>/SKILL.md` and `~/.claude/skills/<name>/SKILL.md`; use the path for the current harness. They do not live under `agent/`
5. Read `runbook/gotchas.md` before the first gate. Attribute each failure by name: it is the base's only when that same test fails on a finished base run with the same command, config, lockfile and generated inputs. A red base never covers a new failure, even at an equal count. A run that did not finish, or ran on other inputs, is unverified. `runbook/gate-base/<base sha7>.md` holds that commit's results, one line per command: exit code, failing tests by name, counts per file, log path; a line counts only for the same command and inputs. A failure it does not list runs on the base as that failing test file alone, with the same command; a whole suite there repeats the full pass to learn one fact:
   - on this checkout while it is still clean at the base commit
   - otherwise in `base-worktree <base-commit>`, which builds `/tmp/base` with deps, env files and generated code linked in. A build output under suspicion is shared through those links, so rebuild it there first

   Whoever runs it, the analysis included, adds its line to that file for every later session and container on the same base
6. A node heap flag is at most three quarters of what `free -m` shows available; a heap set to the whole container is what the kernel kills with exit 137. A check that still dies at that ceiling:
   - goes into `runbook/gotchas.md` as not runnable here, with the memory it had
   - goes once into the closing message's `Question:`, so the host can give the next container more
   - is named as not run, never started again, by every later gate with no more memory than that
7. The build cache already points at `$FLEET_CACHE`, shared by every container on this repo, so your build can restore what an earlier container made. A build that restores nothing from a store that already holds entries is a finding, not a slow day: report it
8. A question for the host goes into `Question:` of the closing message, and the turn ends there. Never a `{{tool.ask}}` dialog here: a steer cannot answer one

## The run

A ticket, a bug report or a feature runs in this order, every output in the task directory. Every step reads `CONTEXT.md`, when the repository has one, for the domain vocabulary that names in tests and code follow, and the ADRs touching the area, which bind it.

1. `analyze-task` writes `analysis.md`; a defect is diagnosed there with `diagnosing-bugs`, before the fix. It ends on one question in the closing message while a decision is still open. An order to deliver end to end answers it, all but a product decision nothing settled; that approval goes into `spec.md` or the ticket, with the user's deciding words and their date, before implementation starts
2. `to-tickets`, when the analysis named tickets, writes `spec.md` and `issues/` and quotes in `analysis.md` what accepted the split. A split no answer named goes back as that question; a changed split changes `analysis.md` first. A ticket that needs its own review carries the line `Review: after this ticket`, written now
3. `implement` works the ticket the order names, or the short run's `analysis.md`: a failing test first with `tdd`, gate output in `logs/gate-<date +%Y%m%dT%H%M%S>/`. A ticket stays a plan: at its end, one edit ticks each acceptance criterion with its evidence beside it
4. A changed requirement goes into its ticket or `spec.md` before the code changes
5. When a review round or a red check lands on the pull request, `babysit-pr` answers it; raw output in `logs/pr-round-<k>/`. Every wait on CI, in that skill or outside it, is `ci-wait <owner>/<repo> <pr number>`

The short run, an `analysis.md` that planned one commit, skips step 2; the opening prompt overrides the choice. A prompt with no ticket behind it runs none of this.

An order to see a change before it is built runs `mockup` first; its frames are the hand-over.

An ADR the run's decisions need is proposed in its pull request, as a commit adding it under `docs/adr/`.

## Checks

Each check runs once, where it is cheapest:

| Check | When | Times per task |
| --- | --- | --- |
| Red test | before the code of each behaviour | 1 per behaviour |
| Ticket tests (changed files and their importers) | after the ticket's code | 1 per ticket, plus reruns while fixing |
| Independent review of the whole branch, `two-axis-review` | after the last ticket's commit, before the final checks | 1 |
| Review fixes | one batch, each with its own test | 1 |
| Branch update, by the method `## Merge method` in `project.md` names | before the final checks | 1, never repeated by a later session |
| Typecheck and lint of changed files | final tree | 1 |
| Tests of affected packages | final tree; on the base only the files that failed | 1 |
| Verification of what a user sees, the way `project.md` names | final tree, after the last visible change | 1 |

- After a change that follows a passed check, each check covers only the base or the last `@sha` it passed on, up to HEAD: tests of affected packages, typecheck and lint of changed files, a review of the delta, frames of the criteria the change touches
- A per-ticket review runs only where the ticket carries `Review: after this ticket`
- Gates run with no bash timeout
- Open the frames before claiming what the user sees

## Closing message

Every turn ends with this message, whatever the turn did:

```text
Changes: <what changed>
Checks: <command> -> exit <n> @ <sha7>, <log path under logs/>
Commits: <sha7> <subject>
Question: <a question for a person, or none>
```

`Checks:` repeats per check; `@ <sha7>` is the commit the check passed on. Review findings you reject go under `Changes:` with the reason. A turn with nothing in a slot writes `none` there.

## Finish

1. Commit unsigned on the task branch
2. The branch update: `git fetch origin` once, on a branch never pushed. `git merge-base --is-ancestor origin/<base> HEAD` exiting 0 means no update; otherwise update by the method `## Merge method` in `project.md` names, a merge where it names none. A conflict is resolved, never aborted, with skill `resolving-merge-conflicts`. A fetch that cannot authenticate leaves the update to the host: name the base the branch sits on in `Question:` and ask for no credential
3. A pushed branch follows the stale-base rules of skill `babysit-pr`. Where the host signs, signing rewrites your commits, so once the host has pushed, `git fetch origin && git reset --hard origin/<branch>` before you touch anything
4. With `repositories.json`, finish and commit each repo separately. Run its gate in its own workspace; an integration test report records every full HEAD SHA captured for that run, and a diff hash for each dirty working tree. The host imports all branches only after its own preflight; signing and pushing need host approval. Push, the pull request and Linear as `permissions.md` in the task directory says, one line per action. The pull request body follows skill `pr`, when the pull request opens and in every later round that changes it. Before the push the head branch does not exist on the remote and `gh` refuses, which is a state to report, not a step to work around
5. The final checks of the table run on the updated tree, and their lines go into the closing message. Nothing in the task directory is committed, so keep code and secrets out
6. Finish with a clean checkout: committed, or the uncommitted files named in `Changes:` with the reason
