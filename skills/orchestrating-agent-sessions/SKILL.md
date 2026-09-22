---
name: orchestrating-agent-sessions
description: 'Fleet containers: put one up, drive it, land its branch, close it. Use when the user asks to run work in an sbx sandbox with pi in a herdr tab, prompt or inspect a running one, bring its branch home, read a `[fleet]` line, find what a container left behind, or make sense of a refusal from `fleet`.'
---

# Fleet containers

One container per task: a private clone in an sbx sandbox, pi waiting in a herdr tab, the user prompting it there. When this session may prompt one is in the Fleet section of your rules.

| Ask | Command | Result to report |
| --- | --- | --- |
| put up a container for ticket X | `fleet up <label> --repo <path> [--branch <name>]` | sandbox name, tab name; pi waiting, no prompt sent |
| what is running | `fleet ls` | one line per container: status, herdr state, branch, dirty count |
| what did it do | `fleet peek <sandbox>` | git status, log, diff --stat, install log, pane tail |
| send it this | `fleet say <sandbox> "<text>"` | prompt logged and sent |
| run something inside | `fleet exec <sandbox> -- <command>` | command output; one quoted argument runs as a shell line, several run as argv |
| what it left for me | `fleet artifacts [--repo <path>]` | the folder, then its files newest first with size and age |
| get one file out | `fleet copy <sandbox>:<path> <local>` | local path |
| bring the branch home | `fleet land <sandbox> [--sign] [--push]` | log and diff --stat of the branch; `--sign` covers only what origin lacks |
| close it | `fleet down <sandbox>` | where the transcripts and the artifacts stayed |
| rebuild the image | `fleet build` | the docker build output, and what the image now carries |
| switch models | `fleet render` (after editing `profiles/models.json`) | files rewritten; host sees it after `/reload` |

After `fleet land --sign --push` the branch is on the remote and the container can open its pull request: it holds a token that writes pull requests and nothing else, so `fleet say <sandbox> "resync and open the PR"` is the step, and the resync comes first because signing rewrote its commits.

The repository inside a container is a private clone, so writes there stay there until `fleet land`. Three host directories are mounted alongside it at the same absolute path inside as outside: `~/.sandboxes/<repo>` (`$FLEET_ARTIFACTS`, shared by every container on that repo) for what workers keep between sessions and leave for a person; `~/.pi/cache/<repo>` for what is expensive to rebuild; and `~/my-knowledge-base` read-only for the personal wiki. They outlive the container, so screenshots and reports in the artifacts directory survive `fleet down`.

## Watching

`fleet_watch`, or `/fleet-watch [names]` typed by the user, watches the agents that exist when it runs, so call it again after every `fleet up`.

- A settling agent arrives as `[fleet] <name>: <prev> -> <status>`. Going back to work is silent, so "did it take the prompt" is a `fleet peek`.
- `blocked` means a dialog waits for the user in that tab. `gone` means the pane or tab closed, and `working -> unknown` usually means pi died in it; read the tab.
- Report the line and stop, unless the user put that container in the follow mode of Fleet rule 3.

## When it refuses

- `fleet down` refuses a dirty tree, and commits that never reached the host repo. `fleet peek` shows what would go, and `--force` discards either.
- `fleet land` refuses a container branch that no longer descends from the one here, which is what a signed landing leaves behind: the container resyncs with `git fetch origin && git reset --hard origin/<branch>`. It also refuses a dirty container tree, a detached HEAD, the base branch itself, and a branch checked out here.
- `fleet land --push` refuses anything that is not a fast-forward.
- `fleet up` ending in `pi did not come up` leaves a tab to read: `herdr agent read <pane> --source recent-unwrapped --lines 60`, and report what it printed.
