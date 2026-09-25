---
name: orchestrating-agent-sessions
description: 'Fleet containers: put one up, steer it, read its task directory, land its branch, close it. Use when the user asks to run work in an sbx sandbox with {{harness}} in a herdr tab, steer or inspect a running one, asks what a task is up to, wants its branch home, or when a `[fleet]` line or a refusal from `{{cli}}` needs reading.'
---

# Fleet containers

One container per task: a private clone in an sbx sandbox, {{harness}} waiting in a herdr tab, one task directory under `~/.sandboxes/<repo>/<sandbox>/` that every skill inside writes and this session reads. When this session may steer is in the Fleet section of your rules; the directory's layout is `refs/artifacts.md`.

| Ask | Command | Result to report |
| --- | --- | --- |
| put up a container for a task | `{{cli}} up <label> --repo <path> [--branch <name>] [--base <name>] [--model {{model.flag}}] [--memory 8g] [--cpus 4]` | sandbox name, tab name, task directory; the branch starts at the freshest `origin/<base>` (`origin/HEAD`, `main`, `master` detected; `--base` when the repo names it otherwise); {{harness}} waiting, no prompt sent |
| what is running | `{{cli}} ls` | one line per container: status, herdr state, branch, dirty count, time since its first prompt, cost so far |
| what is it doing this minute | `{{cli}} peek <sandbox> [--lines 40]` | git status, log, diff --stat, install log, pane tail |
| send it this | `{{cli}} steer <sandbox> "<text>"` | {{steer.result}} |
| run something inside | `{{cli}} exec <sandbox> -- <command>` | command output; one quoted argument runs as a shell line, several run as argv |
| what it left | `{{cli}} artifacts [--repo <path>]` | each task's files with size and age, its folders folded to one line |
| what happened, step by step | `{{cli}} history <sandbox> [--repo <path>]` | every version of `status.md` in order, with its time: status changes, attention, summary, next step and the Log lines it added |
| get one file out | `{{cli}} copy <sandbox>:<path> <local>` | local path |
| bring the branch home | `{{cli}} land <sandbox> [--branch <name>] [--sign] [--push]` | log and diff --stat of the branch; signing follows the profile's `host.sign`, `--sign` forces it, and it covers only what origin lacks and rewrites those commits, so of two branches stacked in one container land the top one |
| what may each seat do in this repository | `{{cli}} profile [<repo>] [--apply]` | the profile's level per action for host and container, one sentence each; `--apply` sets the checkout's signing and, where the host pushes on its own, an HTTPS origin, and prints each change |
| close it | `{{cli}} down <sandbox> [--force]` | the usage line and where the task directory stays |
| rebuild the image | `{{cli}} build` | the docker build output, and what the image now carries |
{{models.row}}

## Wording a steer

A steer is the order itself, in your voice, in this order: what to do, what is decided, where to stop. A decision arrives as `Decided: <what>`, whoever took it; your report to the user names every decision you took yourself. How the work runs (reviews, commits, session handoffs) is the container's rules' to decide, and a decision already sits in `spec.md` once the container has it, so after a handoff the stock continue is the whole steer; on a run without `spec.md`, the continue carries the `Decided:` lines again. Keep a steer to a few sentences: a long one reaches the container as pasted content, which it may read as data rather than an order.

```text
Deliver WEB-1716 and WEB-1718 end to end. Decided: restoring an agency brings back only the organizations deleted with it. Stop at ready-for-host.
```

## Coordinating a project

The host plans, delegates, accepts or rejects, and merges; containers implement and propose, and never merge. The loop is the same in every repository, and `{{cli}} profile <repo>` sets how much of it runs without the user.

1. The plan lives in the project repository under `spec/`, in the shape its `AGENTS.md` sets. A container's task directory is the record of one job, not the plan
2. The first ticket of a new application is its skeleton with CI, because required checks judge every merge
3. For a planned ticket the steer is one line: the outcome and a pointer to the ticket
4. Tickets that share no files or subsystems and wait on no other ticket run in parallel, one container each, as many as the profile's memory per container fits into the host's RAM
5. Accept by reading `status.md`, `review.md` and the checks, then merge where the profile gives the host merge `auto`, or hand the merge to the user
6. A small plan edit the host makes itself, on a branch and its pull request where its profile allows; a larger one goes to a container
7. A tracker (Linear or another) is an optional mirror, configured in the project's `AGENTS.md`, updated on a state change only and mapped by state type; on drift the plan files win
8. A fresh host session resumes from `spec/` and `{{cli}} ls`

## Reading a task

| Question | Read |
| --- | --- |
| where is it, does it need anyone, which PR, what is at risk or uncommitted | `status.md` |
| what happened, in order | `## Log` in `status.md`; every version of the file with `{{cli}} history` |
| which commits | `{{cli}} ls` for the branch and its dirty count, `git log <base>..<branch>` after `{{cli}} land` |
| what did the analysis find | `analysis.md` |
| what did the reviewer find, which checks ran with which exit | `review.md`; its `Range:` is what it covered |
| what is happening on the PR | `pr.md` |
| what is it doing this minute, before `status.md` moved | `{{cli}} peek` |
| why did that test fail, what exactly was said | the file under `logs/` that one of the above points at |

A rule or skill change reaches a container through `{{cli}} build` and a new container. A running container keeps the rules it started with.

Where the profile gives the container push `none`, `{{cli}} land --sign --push` puts the branch on the remote and the container can then open its pull request: `{{cli}} steer <sandbox> "resync and open the PR"` is the step, and the resync comes first because signing rewrote its commits. Where the container pushes, its branch and pull request reach GitHub without a landing.

The repository inside a container is a private clone, so writes there stay there until `{{cli}} land`, or until the container pushes where its profile gives it push `auto`. Three host directories are mounted alongside it at the same absolute path inside as outside: `~/.sandboxes/<repo>` (`$FLEET_ARTIFACTS`, shared by every container on that repo, holding one task directory per container and `runbook/`); `{{cache}}` for what is expensive to rebuild; and `~/my-knowledge-base` read-only for the personal wiki. They outlive the container, so `{{cli}} down` leaves the task directory, its sessions and `logs/usage.json` behind.

## Watching

{{file:watching}}
- `blocked` means a dialog waits for the user in that tab. `gone` means the pane or tab closed. A settle or `unknown` while `status.md` says the work goes on usually means {{harness}} waits on something in the background, a sub-agent or a long command; `{{cli}} peek` tells that from a crash before you act on it.
- Steer, then the wake: the same sequence for a container you watch and one you drive end to end.

## Session handoff

A container suggests a session handoff at a natural break, from the same table it holds:

{{file:natural-breaks}}

The host judges it again, with `{{cli}} peek` for what runs, since a handoff ends whatever is:

| `attention:` | The last `## Log` line | Background | The host |
| --- | --- | --- | --- |
| the suggestion | a natural break | idle | approves |
| the suggestion | a natural break | running | waits for the next wake and judges again |
| the suggestion | anything else | any | steers the container on in its session, naming what is left before the next natural break |
| no suggestion | a natural break | idle | may start the handoff itself |

Who decides:

| Task | Decision |
| --- | --- |
| delegated end to end by the user, explicitly | the host, without asking again |
| driven manually | the user; ask and wait for explicit approval |

This is the authority rule for session handoff; it grants no other permission.

{{file:session-handoff}}

## When it refuses

- `{{cli}} down` refuses a dirty tree, and commits that reached neither the host repo nor the container's origin. `{{cli}} peek` shows what would go, and `--force` discards either.
- `{{cli}} land` refuses a container branch that no longer descends from the one here, which is what a signed landing leaves behind: the container resyncs with `git fetch origin && git reset --hard origin/<branch>`. It also refuses a dirty container tree, a detached HEAD, the base branch itself, and a branch checked out here.
- `{{cli}} land --push` refuses anything that is not a fast-forward.
- `{{cli}} steer` answers `agent_blocked` while a dialog waits in that tab: read the pane, ask the user, answer the dialog, then steer.
- `{{cli}} up` ending in `{{harness}} did not come up` leaves a tab to read: `herdr agent read <pane> --source recent-unwrapped --lines 60`, and report what it printed.
