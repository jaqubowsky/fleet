---
name: orchestrating-agent-sessions
description: 'Fleet containers: put one up, steer it, read its task directory, land its branch, close it. Use when the user asks to run work in an sbx sandbox with pi in a herdr tab, steer or inspect a running one, asks what a task is up to, wants its branch home, or when a `[fleet]` line or a refusal from `fleet` needs reading.'
---

# Fleet containers

One container per task: a private clone in an sbx sandbox, pi waiting in a herdr tab, one task directory under `~/.sandboxes/<repo>/<sandbox>/` that every skill inside writes and this session reads. When this session may steer is in the Fleet section of your rules; the directory's layout is `refs/artifacts.md`.

| Ask | Command | Result to report |
| --- | --- | --- |
| put up a container for ticket X | `fleet up <label> --repo <path> [--branch <name>] [--base <name>] [--model <provider/id:thinking>] [--memory 8g] [--cpus 4]` | sandbox name, tab name, task directory; the branch starts at the freshest `origin/<base>` (`origin/HEAD`, `main`, `master` detected; `--base` when the repo names it otherwise); pi waiting, no prompt sent |
| what is running | `fleet ls` | one line per container: status, herdr state, branch, dirty count, time since its first prompt, cost so far |
| what is it doing this minute | `fleet peek <sandbox> [--lines 40]` | git status, log, diff --stat, install log, pane tail |
| send it this | `fleet steer <sandbox> "<text>"` | steered; pi takes it after its current tool call, and the container is under watch from now on |
| run something inside | `fleet exec <sandbox> -- <command>` | command output; one quoted argument runs as a shell line, several run as argv |
| what it left | `fleet artifacts [--repo <path>]` | each task's files with size and age, its folders folded to one line |
| get one file out | `fleet copy <sandbox>:<path> <local>` | local path |
| bring the branch home | `fleet land <sandbox> [--sign] [--push]` | log and diff --stat of the branch; `--sign` covers only what origin lacks |
| close it | `fleet down <sandbox> [--force]` | the usage line and where the task directory stays |
| rebuild the image | `fleet build` | the docker build output, and what the image now carries |
| switch models for new containers | `fleet render` after editing `profiles/models.json` | files rewritten; host sees it after `/reload`, containers after `fleet build` |

## Reading a task

| Question | Read |
| --- | --- |
| where is it, does it need anyone, which PR, what is at risk or uncommitted | `status.md` |
| which commits | `fleet ls` for the branch and its dirty count, `git log <base>..<branch>` after `fleet land` |
| what did the analysis find | `analysis.md` |
| what did the reviewer find, which checks ran with which exit | `review.md` |
| what is happening on the PR | `pr.md` |
| what is it doing this minute, before `status.md` moved | `fleet peek` |
| why did that test fail, what exactly was said | the file under `logs/` that one of the above points at |

A rule or skill change reaches a container through `fleet build` and a new container. A running container keeps the rules it started with.

After `fleet land --sign --push` the branch is on the remote and the container can open its pull request: it holds a token that writes pull requests and nothing else, so `fleet steer <sandbox> "resync and open the PR"` is the step, and the resync comes first because signing rewrote its commits.

The repository inside a container is a private clone, so writes there stay there until `fleet land`. Three host directories are mounted alongside it at the same absolute path inside as outside: `~/.sandboxes/<repo>` (`$FLEET_ARTIFACTS`, shared by every container on that repo, holding one task directory per container and `runbook/`); `~/.pi/cache/<repo>` for what is expensive to rebuild; and `~/my-knowledge-base` read-only for the personal wiki. They outlive the container, so `fleet down` leaves the task directory, its sessions and `logs/usage.json` behind.

## Watching

Every container this session put up or steered is under watch by itself, from the log `fleet up` and `fleet steer` write, and a session restart picks the live ones back up. `fleet_watch <sandbox...>`, or `/fleet-watch [names]` typed by the user, is for the rest: containers someone else drives, by the sandbox name `fleet ls` prints; no name watches every agent.

A watched container working on without settling wakes you with `working <n>m without settling`, and again while it goes on. That wake is a `fleet peek`, then either a steer that names what to stop or the end of the turn.

- A settling agent wakes you with `[fleet] <name>: <prev> -> <status>`, then the `status.md` brief, the commits on its branch and the review verdict when `review.md` exists. The wake turn is one line, the agent and its change, then either the next steer when the task is yours to drive or the end of the turn. Going back to work is silent.
- `blocked` means a dialog waits for the user in that tab. `gone` means the pane or tab closed, and `working -> unknown` usually means pi died in it; read the tab.
- Steer, then the wake: the same sequence for a container you watch and one you drive end to end.

## Session handoff

When `attention:` says `session handoff requested`, approval is routine local execution only for a task the user explicitly delegated end to end: the host may approve without asking again. For a manually driven task, ask the user and wait for explicit approval. This is the authority rule for session handoff; it grants no other permission.

Once authorized, send `fleet steer <sandbox> "Approve session handoff"`. The container's `session_handoff` tool queues the switch; the host never loads that extension. Read `status.md` until `attention:` says `session handoff complete; fresh session idle`, using the next fleet wake rather than a poll loop. A cancellation stays in the previous session. For an end-to-end task, the host may then separately steer `Continue the previous task: read current durable artifacts and follow Next step in status.md.` For a manual task, the fresh session waits for the user's next message. The hidden prior-task pointer is optional background, not a continuation request.

## When it refuses

- `fleet down` refuses a dirty tree, and commits that never reached the host repo. `fleet peek` shows what would go, and `--force` discards either.
- `fleet land` refuses a container branch that no longer descends from the one here, which is what a signed landing leaves behind: the container resyncs with `git fetch origin && git reset --hard origin/<branch>`. It also refuses a dirty container tree, a detached HEAD, the base branch itself, and a branch checked out here.
- `fleet land --push` refuses anything that is not a fast-forward.
- `fleet steer` answers `agent_blocked` while a dialog waits in that tab: read the pane, ask the user, answer the dialog, then steer.
- `fleet up` ending in `pi did not come up` leaves a tab to read: `herdr agent read <pane> --source recent-unwrapped --lines 60`, and report what it printed.
