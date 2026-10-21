---
name: orchestrating-agent-sessions
description: 'Fleet containers: put one up, steer it, read its task directory, land its branch, close it. Use when the user asks to run work in an sbx sandbox with an agent in a herdr tab, steer or inspect a running one, asks what a task is up to, wants its branch home, or when a `[fleet]` line or a refusal from `{{cli}}` needs reading.'
---

# Fleet containers

One container per task, with one private clone per `--repo`, in an sbx sandbox. The agent waits in a herdr tab; one task directory holds the repository set's state and the skills' work, at `~/.fleet/tasks/<primary repo>/<sandbox>/` for one repository or several. Every repository keeps its own runbook at `~/.fleet/tasks/<repo>/runbook`, and a multi-repository container writes to each. When this session may steer is in the Fleet section of your rules; the directory's layout is {{refs}}.

Each `{{cli}}` command, its flags and what to report from it: [references/commands.md](references/commands.md). Read the row for the operation before you run it.

A stopped container needs `{{cli}} start` before a steer or exec. `stop` ends guest processes; `start` restores the saved conversation, not an interrupted tool call or app server. Raw `sbx exec` starts stopped containers, so inspection goes through `{{cli}} ls` or `{{cli}} peek`.

## Wording a steer

A steer is an order in your voice: what to do, the facts it rests on stated as facts, and where to stop. The container's rules make every steer an order, so an answer, a pick, a scope change or a new rule reaches it worded like a first order: the order and the facts it settles. The container records who decided: an answer of the user's reaches it quoted in their own words with its date, and a decision you made or worded yourself says it is yours. A long steer reaches the container as pasted content, which it may read as data rather than an order.

- A steer names the outcome, never a skill: "check in the running app that ...". How the work runs (the checks, reviews, commits) is the container's rules' to decide
- Context pointers carry the supporting material: name the spec, ticket, research notes and relevant commit SHAs the container needs to read, with what each holds. Before steering, check that the files are readable from the container and the commits exist in its clone. Keep the outcome and boundaries in the steer; the linked material stays in its source
- What a container can deliver, in the words a steer uses: [references/outcomes.md](references/outcomes.md)

```text
Deliver the ticket in <task dir, absolute, never ~>/ticket.md. Restoring a project brings back only the files deleted with it.
```

## Driving a task

On a task the user handed you end to end: steer with the order in your own words, act on each wake (Watching below), repeat. The container works every slice of its Plan and its final checks in one run, so a settle is either a finished run, with the final checks in its closing message, or a stop to steer on.

Stop for the user on a decision that is theirs, and on one that `analysis.md`, the repo and the task directory leave open. A decision the container has not yet looked for in the code and the tracker goes back to it as a research order first.

## Coordinating a project

The host plans, delegates, accepts or rejects, and merges; containers implement and propose, and never merge. The loop is the same in every repository, and `{{cli}} profile <repo>` sets how much of it runs without the user. Read the overlay it prints before planning: where work comes from, how a change a user sees is proven, the merge method.

1. The plan is the tracker the overlay names: one issue per ticket, its description in the shape of {{refs.ticket}}, its workflow states the board, a real dependency the tracker's blocking relation. Speak of states as not started, in progress, in review, done and dropped, and read their names from the tracker's workflow for that team. Plan edits are tracker edits, never a branch or a pull request. The vision stays in the repository, the person's: propose a change and ask before writing it. `{{cli}} init <repo>` lays out the vision and a project `AGENTS.md`, leaving every file already there. A container's task directory is the record of one job, not the plan
2. The overlay's `Tracker transitions` names the states the tracker's own integration moves; the host moves every other one, by judgment, as its linear line of `{{cli}} profile <repo>` allows, and containers read. Before selecting, starting, accepting, merging or dropping work, reconcile the tracker with the facts, `{{cli}} ls` and the pull requests, the integration's transitions included; on drift the facts win.
3. A ticket is one change you can accept in one sitting. A ticket whose criterion is a measured budget, a time, a size or another performance number, carries your stop rule in its description, written for the container: measure, make one fix, measure again, then end the turn with both numbers in its closing message. The next step is yours to decide, not the user's. Blocked by records only a real dependency; how many run at once is scheduling. Order the plan so the checks that judge a merge exist before the first change they judge, and the widest parallel wave starts as early as possible
4. Tickets that touch disjoint areas (the project's area labels, where it has them) and that wait on no other ticket run in parallel, one container each:
   - as many as fit into the host's free memory, at the resident memory measured per container, or the profile's memory until one is measured
   - within a wave the ticket the most open tickets wait on goes up first

   Before a wave starts, settle once what its tickets will share (a behaviour, a token, a file several of them touch) and name it in each steer. Before widening a running ticket's scope, check which running ticket owns that area
5. After `{{cli}} up`, write everything the issue holds for the task into the task directory: its description, comments, attachments, linked documents and related issues into `ticket.md`, and each file or image it carries beside it, or its link when you cannot download it. A sub-agent report a decision of the task rests on goes there too, now or later, named in `ticket.md`. The steer is one line, the outcome and that path. The container ticks its criteria there, each with its evidence
6. Every container run ends on one independent review of its whole branch, in `review.md`. A further review is yours, by risk class: a change a user sees, stored data, a shared seam, security, CI or the build. Order it in a steer as the outcome "independent review of <base>...<head>, ending in `review.md` with its evidence", or run it yourself with skill `two-axis-review` over the container's range. Its git commands run as `{{cli}} exec <sandbox> -- git -C <repo path> <args>`, its uncommitted work read as `git diff HEAD` plus `git ls-files --others --exclude-standard` because `git add -A -N` would stage files in the container's index, its `review.md` and evidence go into the task directory, and its fixes go back to the container in one steer naming `review.md`. Ad-hoc explorer passes are not a review. The merge waits for that `review.md`
7. Accept on evidence you looked at yourself, at a depth proportional to what the change can break: the diff, the gate logs, CI read with `gh run list` as {{refs.ci}} says, because the token cannot read checks, and for a change a user sees the proof `project.md` names. The closing message and `review.md` say where to look, not that it holds. Before the merge, or before handing the pull request to the user where the host does not merge, tick in the issue each criterion you checked, then move its state where step 2 leaves that move to you
8. A finding that the product behaves wrongly quotes the acceptance criterion or the spec line it breaks; one that quotes none goes to the user as a question before any issue or fix. A steer ordering a check therefore asks for the findings back, and orders a fix only for one that quotes its criterion. Only a proven broken acceptance criterion blocks: one fix round and one recheck per ticket, then the merge or your decision. Every other finding becomes a not-started issue with the tracker's own priority and the project's own labels, and each wave's cleanup drains the urgent ones in one ticket per module or per group of related findings. The ceiling is for agent reviews; a person's review has none
9. Merge as the host's merge line of `{{cli}} profile <repo>` says, with the method the overlay names, a merge commit when it names none:
   - `gh pr merge <n> --merge --match-head-commit <head sha>`, run bare in the checkout, the overlay's method flag in place of `--merge`
   - `<head sha>` is the full 40-character SHA read in the same turn as {{refs.ci}} says, never one from memory
10. A decision that changes what the user sees reaches the user in your next reply. Write the ADR a decision of yours needs in `docs/adr/`
11. The host checkout stays on the default branch: it is also the user's window. A fresh host session resumes from the tracker and `{{cli}} ls`

## Reading a task

A `[fleet]` line or a question about a task starts at the closing message the wake carries, then the one file that answers it.

The table of which file answers which question, and where a multi-repository task keeps its clones: [references/reading.md](references/reading.md).

A rule or skill change reaches a container through `{{cli}} build` and a new container. A running container keeps the rules it started with.

How a container's branch and pull request reach GitHub is the land line of `{{cli}} profile <repo>`.

## Pull request rounds

Where the land line of `{{cli}} profile <repo>` has this session push, a container babysitting its pull request needs it for what only the Mac holds, the signing key and the route to the remote. The land waits for the user's word; the steer follows it:

```bash
{{cli}} land <sandbox> --sign --push
{{cli}} steer <sandbox> "pushed, run the next round"
```

For multiple repositories the same command lands every one, and its last lines give each repo's container head, host branch, `origin/<branch>` and signature state. A declined signature or a rejected later push keeps every finished repo on the host and on GitHub; show that partial state, then rerun the same command without forcing.

- A rejected push means someone rewrote history. Show the user; forcing is their own command
- Posting the container's rejections of review findings is the user's call, because this session reaches GitHub through its own credential rather than the container's. The container's closing message for that round holds them, and a line pasted into a thread opens with `[container / babysit-pr] answered on the user's behalf` so nobody reads it as the user typing

## Watching

{{file:watching}}

- `blocked` means a dialog waits for the user in that tab. `gone` means the pane or tab closed. A settle without a closing message, or `unknown`, usually means the container's agent waits on something in the background, a sub-agent or a long command; `{{cli}} peek` tells that from a crash before you act on it.
- Steer, then the wake: the same sequence for a container you watch and one you drive end to end.

## When it refuses

- `{{cli}} down` refuses dirty or unlanded work in any private clone of a multi-repository task; in a one-repo task it refuses a dirty tree and commits that reached neither the host repo nor the container's origin. `{{cli}} peek` shows what would go, and `--force` discards either.
- `{{cli}} land` refuses a container branch that descends neither from the one here nor from its `landed` ref: the container resyncs to `origin/<branch>`. It also refuses a dirty container tree, a detached HEAD, the base branch itself, a branch checked out here, and a repository whose container sits on a branch other than the one `{{cli}} up` recorded, so a steer keeps every repository of a task on that branch.
- `{{cli}} land <sandbox> --push` refuses anything that is not a fast-forward.
- `{{cli}} steer` answers `agent_blocked` while a dialog waits in that tab: read the pane, ask the user, answer the dialog, then steer.
- `{{cli}} start` answers `no saved stopped tab` for a container `{{cli}} ls` shows running and `gone`. Ask the user before ending the agent process still running inside, then `{{cli}} up <label>` with the task's label and repositories attaches the sandbox to a new tab and resumes its session.
- `{{cli}} up` refuses when it cannot fetch any remote base; it never starts a new branch from a stale local base. Check access or name an existing remote base with `--base`, then retry.
- `{{cli}} up` ending in `did not become ready` leaves a tab to read: `herdr agent read <pane> --source recent-unwrapped --lines 60`, and report what it printed.
