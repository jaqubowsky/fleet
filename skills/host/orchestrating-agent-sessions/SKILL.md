---
name: orchestrating-agent-sessions
description: 'Fleet containers: put one up, steer it, read its task directory, land its branch, close it. Use when the user asks to run work in an sbx sandbox with an agent in a herdr tab, asks what a running task is up to, or when a `[fleet]` line or a refusal from `{{cli}}` needs reading.'
---

# Fleet containers

One container per task, with one private clone per `--repo`, in an sbx sandbox. The agent waits in a herdr tab; its task directory, `~/.fleet/tasks/<primary repo>/<sandbox>/`, holds the task's state and the skills' work, laid out as {{refs}}. Every repository keeps its runbook at `~/.fleet/tasks/<repo>/runbook`. When this session may steer is in the Fleet section of your rules.

`{{cli}} --help` lists every command and its flags, and each command's output and refusals name the next step. What they leave out:

- A stopped container needs `{{cli}} start` before a steer or exec. `start` restores the saved conversation, not an interrupted tool call or app server. Inspect through `{{cli}} ls` or `{{cli}} peek`: raw `sbx exec` starts a stopped container
- `{{cli}} down --force` discards work, and only the user runs it
- `{{cli}} start` answering `no saved stopped tab` for a container `{{cli}} ls` shows running and `gone`: ask the user before ending the agent process still inside, then `{{cli}} up <label>` with the task's label and repositories attaches it to a new tab and resumes its session
- Once a container's branch is landed, a second branch of it comes home with `git -C <repo> fetch sandbox-<sandbox> <branch>:<branch>` and `git push`
- A rule or skill change reaches a container through `{{cli}} build` and a new container; a running one keeps the rules it started with
- Models for new containers: edit `<kind>/profiles/models.json` in the harness repo and run `{{cli}} render`, or pass `--model` to one `{{cli}} up`. Containers take it after `{{cli}} build`, the host {{reload.models}}

## Putting a task up

After `{{cli}} up`, write everything the issue holds into the task directory: its description, comments, attachments, linked documents and related issues into `ticket.md`, below the first line `{{cli}} up` wrote there, which starts the container's delivery, and each file or image it carries beside it, or its link when you cannot download it. A sub-agent report a decision of the task rests on goes there too, now or later, named in `ticket.md`. The steer is one line, the outcome and that path. The container ticks its criteria there, each with its evidence.

## Wording a steer

A steer is an order in your voice: what to do, the facts it rests on stated as facts, and where to stop. An answer, a pick, a scope change or a new rule reaches the container worded like a first order: the order and the facts it settles. An answer of the user's goes quoted in their own words with its date; a decision you made or worded yourself says it is yours. A long steer reaches the container as pasted content, which it may read as data rather than an order.

- A steer names the outcome, never a skill: "check in the running app that ...". How the work runs is the container's rules' to decide
- Context pointers carry the supporting material: name the spec, ticket, research notes and commit SHAs the container needs, with what each holds, after checking that the files are readable from the container and the commits exist in its clone
- What a container can deliver, in the words a steer uses: [references/outcomes.md](references/outcomes.md)

```text
Deliver the ticket in <task dir, absolute, never ~>/ticket.md. Restoring a project brings back only the files deleted with it.
```

## Driving a task

On a task the user handed you end to end: steer with the order in your own words, act on each wake, repeat. The container works every slice of its Plan and its final checks in one run, so a settle is either a finished run, with the final checks in its closing message, or a stop to steer on.

Stop for the user on a decision that is theirs, and on one that `analysis.md`, the repo and the task directory leave open. A decision the container has not yet looked for in the code and the tracker goes back to it as a research order first.

When the user hands you a project, a plan or several tickets to run as a whole, read [references/coordinating.md](references/coordinating.md) before the first `{{cli}} up`: the tracker as the plan, waves, the review, acceptance and the merge.

The host checkout stays on the default branch: it is also the user's window. A fresh host session resumes from the tracker and `{{cli}} ls`.

## Reading a task

A `[fleet]` line or a question about a task starts at the closing message the wake carries, then the one file that answers it: [references/reading.md](references/reading.md).

## Landing

The land line of `{{cli}} profile <repo>` says how a container's branch and pull request reach GitHub and what to steer after; a land waits for the user's word. `{{cli}} land` and `{{cli}} down` run bare: one line, one sandbox name, no pipe, `cd` or `2>&1`, their flags read from `{{cli}} --help`. A multi-repository land stopped by a declined signature or a rejected push keeps every repository it finished: show that state, then rerun the same command.

Posting the container's rejections of review findings is the user's call, because this session reaches GitHub through its own credential rather than the container's. The container's closing message for that round holds them, and a line pasted into a thread opens with `[container / babysit-pr] answered on the user's behalf` so nobody reads it as the user typing.

## Watching

{{file:watching}}

A settle without a closing message, or `unknown`, usually means the container waits on something in the background, a sub-agent or a long command; `{{cli}} peek` tells that from a crash before you act on it.
