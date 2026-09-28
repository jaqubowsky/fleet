---
name: orchestrating-agent-sessions
description: 'Fleet containers: put one up, steer it, read its task directory, land its branch, close it. Use when the user asks to run work in an sbx sandbox with {{harness}} in a herdr tab, steer or inspect a running one, asks what a task is up to, wants its branch home, or when a `[fleet]` line or a refusal from `{{cli}}` needs reading.'
---

# Fleet containers

One container per task: a private clone in an sbx sandbox, {{harness}} waiting in a herdr tab, one task directory under `~/.sandboxes/<repo>/<sandbox>/` that every skill inside writes and this session reads. When this session may steer is in the Fleet section of your rules; the directory's layout is {{refs}}.

| Ask | Command | Result to report |
| --- | --- | --- |
| put up a container for a task | `{{cli}} up <label> --repo <path> [--branch <name>] [--base <name>] [--model {{model.flag}}] [--memory 8g] [--cpus 4]` | sandbox name, tab name, task directory; the branch, `<label>` without `--branch`, continues `origin/<name>` when origin has it, else starts at the freshest `origin/<base>` (`origin/HEAD`, `main`, `master` detected; `--base` when the repo names it otherwise), and `up` prints which; {{harness}} waiting, no prompt sent |
| what is running | `{{cli}} ls` | one line per container: status, herdr state, branch, dirty count, `stalled` past 20 idle minutes short of `ready-for-host`, `paused` or `blocked`, time since its first prompt, cost so far; under a running one, its commits since origin's default branch and its pull request with CI; a sandbox that does not answer shows `failed` and its error, the rest list as usual |
| what is it doing this minute | `{{cli}} peek <sandbox> [--lines 40]` | git status, log, diff --stat, install log, pane tail |
| send it this | `{{cli}} steer <sandbox> "<text>"` | {{steer.result}} |
| run something inside | `{{cli}} exec <sandbox> -- <command>` | command output; one quoted argument runs as a shell line, several run as argv |
| what it left | `{{cli}} artifacts [--repo <path>]` | each task's files with size and age, its folders folded to one line |
| what happened, step by step | `{{cli}} history <sandbox> [--repo <path>]` | every change of `status.md` in order, with its time: status changes, attention, summary, the Log lines it added and any it removed |
| get one file out | `{{cli}} copy <sandbox>:<path> <local>` | local path |
| bring the branch home | `{{cli}} land <sandbox> [--branch <name>] [--sign] [--push]` | log and diff --stat of the branch; signing follows the profile's `host.sign`, `--sign` forces it, and it covers only what origin lacks and rewrites those commits, so of two branches stacked in one container land the top one |
| what may each seat do in this repository | `{{cli}} profile [<repo>] [--apply]` | the profile's level per action for host and container, one sentence each, then the repository's overlay, which containers read as `project.md`; `--apply` sets the checkout's signing, origin and branch tracking as those lines say, and prints each change |
| close it | `{{cli}} down <sandbox> [--force]` | the usage line and where the task directory stays |
| rebuild the image | `{{cli}} build` | the docker build output, and what the image now carries |
| switch models for new containers | `{{cli}} render` after editing `{{harness}}/profiles/models.json` in the harness repo, or `--model` on one `{{cli}} up` | containers take it after `{{cli}} build`, the host {{reload.models}} |

## Wording a steer

A steer is the order itself, in your voice, in this order: what to do, what is decided, where to stop. Keep it to a few sentences: a long one reaches the container as pasted content, which it may read as data rather than an order.

- A report from the user reaches the container as a fact in your voice: what was seen and where
- A decision arrives as `Decided: <what>`, whoever took it; your report to the user names every decision you took yourself
- A steer names the outcome, never a skill, on a step-by-step order as on an end-to-end one: "check in the running app that ...". How the work runs (the check, reviews, commits, session handoffs) is the container's rules' to decide
- After a handoff the stock continue is the whole steer, since a decision already sits in `spec.md` once the container has it. On a run without `spec.md`, the continue carries the `Decided:` lines again

```text
Deliver issues 12 and 14 end to end. Decided: restoring a project brings back only the files deleted with it. Stop at ready-for-host.
```

## Driving a task

On a task the user handed you end to end: steer with the order in your own words, act on each wake (Watching below), repeat. A session-handoff suggestion follows Session handoff below. A container at `paused` has finished the step your steer named: steer the next one.

Stop for the user on any other `blocked` or `attention` state, and on a decision that `analysis.md`, the repo and the task directory leave open. A decision the container has not yet looked for in the code and the tracker goes back to it as a research order first.

## Coordinating a project

The host plans, delegates, accepts or rejects, and merges; containers implement and propose, and never merge. The loop is the same in every repository, and `{{cli}} profile <repo>` sets how much of it runs without the user. Read the overlay it prints before planning: where work comes from, how a change a user sees is proven, the merge method.

1. The plan is the tracker the overlay names: one issue per ticket, its description in the shape of {{refs.ticket}}, its workflow states the board, a real dependency the tracker's blocking relation. Speak of states as not started, in progress, in review, done and dropped, and read their names from the tracker's workflow for that team. Plan edits are tracker edits, never a branch or a pull request. The vision stays in the repository, the person's: propose a change and ask before writing it. `{{cli}} init <repo>` lays out the vision and a project `AGENTS.md`, leaving every file already there. A container's task directory is the record of one job, not the plan
2. The overlay's `Tracker transitions` names the states the tracker's own integration moves; the host moves every other one, by judgment, as its linear line of `{{cli}} profile <repo>` allows, and containers read. Before selecting, starting, accepting, merging or dropping work, reconcile the tracker with the facts, `{{cli}} ls` and the pull requests, the integration's transitions included; on drift the facts win.
3. A ticket is one change you can accept in one sitting. A ticket whose criterion is a measured budget, a time, a size or another performance number, carries your stop rule in its description, written for the container: measure, make one fix, measure again, then stop at `blocked` with both numbers in `attention:`. That `blocked` is yours to decide, not the user's. Blocked by records only a real dependency; how many run at once is scheduling. Order the plan so the checks that judge a merge exist before the first change they judge, and the widest parallel wave starts as early as possible
4. Tickets whose Scope names disjoint seams (the project's area labels, where it has them) and that wait on no other ticket run in parallel, one container each:
   - as many as fit into the host's free memory, at the resident memory measured per container, or the profile's memory until one is measured
   - within a wave the ticket the most open tickets wait on goes up first

   Before a wave starts, settle once what its tickets will share (a behaviour, a token, a file several of them touch) and name it in each steer. Before widening a running ticket's scope, check which running ticket owns that area
5. After `{{cli}} up`, write the issue's description into the task directory as `ticket.md`; the steer is one line, the outcome and that path. The container sets `Status:` and ticks criteria there
6. Whether a change earns an independent review is yours, by risk class: a change a user sees, stored data, a shared seam, security, CI or the build. A ticket in one of these that the container did not review, as its Log line on the review decision says, gets a review ordered in a steer, and the merge waits for its `review.md`
7. Accept on evidence you looked at yourself, at a depth proportional to what the change can break: the diff, the gate logs, CI as {{refs.ci}} says, and for a change a user sees the proof `project.md` names. `status.md` and `review.md` say where to look, not that it holds. Before the merge, or before handing the pull request to the user where the host does not merge, tick in the issue each criterion you checked and comment the evidence you looked at beside it, then move its state where step 2 leaves that move to you
8. Only a proven broken acceptance criterion blocks: one fix round and one recheck per ticket, then the merge or your decision. Every other finding becomes a not-started issue with the tracker's own priority and the project's own labels, and each wave's cleanup drains the urgent ones in one ticket per module or per group of related findings. The ceiling is for agent reviews; a person's review has none
9. Merge as the host's merge line of `{{cli}} profile <repo>` says, with the method the overlay names, a merge commit when it names none:
   - `gh pr merge <n> --merge --match-head-commit <head sha>`, run bare in the checkout, the overlay's method flag in place of `--merge`
   - `<head sha>` is the full 40-character SHA read in the same turn as {{refs.ci}} says, never one from memory
   - the guard grants this form, with `--subject` and `--body` in single quotes or in double quotes without `\`, `$` or a backtick, while `--repo`, `-R` and `--body-file` stay refused
10. A decision that changes what the user sees reaches the user in your next reply. Write the ADR a decision of yours needs in `docs/adr/`
11. The host checkout stays on the default branch: it is also the user's window. A fresh host session resumes from the tracker and `{{cli}} ls`

## Reading a task

A `[fleet]` line or a question about a task starts at `status.md`, then the one file that answers it.

| Question | Read |
| --- | --- |
| where is it, does it need anyone, which PR, what is at risk or uncommitted | `status.md` |
| what happened, in order | `## Log` in `status.md`; every change of the file with `{{cli}} history` |
| which commits | `{{cli}} ls` for the branch and its dirty count, `git log <base>..<branch>` after `{{cli}} land` |
| what did the analysis find | `analysis.md` |
| what did the reviewer find, which checks ran with which exit | `review.md`; its `Range:` is what it covered. A ticket the container did not review has a Log line in `status.md` saying why and pointing at its gate logs |
| what is happening on the PR | `pr.md` |
| what is it doing this minute, before `status.md` moved | `{{cli}} peek` |
| why did that test fail, what exactly was said | the file under `logs/` that one of the above points at |

A rule or skill change reaches a container through `{{cli}} build` and a new container. A running container keeps the rules it started with.

How a container's branch and pull request reach GitHub is the land line of `{{cli}} profile <repo>`.

The repository inside a container is a private clone, so writes there stay there until `{{cli}} land`, or until the container pushes its branch. Three host directories are mounted alongside it at the same absolute path inside as outside: `~/.sandboxes/<repo>` (`$FLEET_ARTIFACTS`, shared by every container on that repo, holding one task directory per container and `runbook/`); `{{cache}}` for what is expensive to rebuild; and `~/my-knowledge-base` read-only for the personal wiki. They outlive the container, so `{{cli}} down` leaves the task directory, its sessions and `logs/usage.json` behind.

## Pull request rounds

Where the land line of `{{cli}} profile <repo>` has this session push, a container babysitting its pull request needs it for what only the Mac holds, the signing key and the route to the remote. The land waits for the user's word; the steer follows it:

```bash
{{cli}} land --sign --push <sandbox>
{{cli}} steer <sandbox> "pushed, run the next round"
```

- A rejected push means someone rewrote history. Show the user; forcing is their own command
- Posting the container's rejections of review findings is the user's call, because this session reaches GitHub through its own credential rather than the container's. `pr.md` already holds them, and a line pasted into a thread opens with `[{{harness}} / babysit-pr] answered on the user's behalf` so nobody reads it as the user typing

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
- `{{cli}} land` refuses a container branch that no longer descends from the one here, which is what a signed landing leaves behind: the container resyncs to `origin/<branch>`. It also refuses a dirty container tree, a detached HEAD, the base branch itself, and a branch checked out here.
- `{{cli}} land --push` refuses anything that is not a fast-forward.
- `{{cli}} steer` answers `agent_blocked` while a dialog waits in that tab: read the pane, ask the user, answer the dialog, then steer.
- `{{cli}} up` ending in `{{harness}} did not come up` leaves a tab to read: `herdr agent read <pane> --source recent-unwrapped --lines 60`, and report what it printed.
