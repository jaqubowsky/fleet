{{watch.source}}

A watched container working on without settling wakes you with `working <n>m without settling`, and again while it goes on; one whose tool calls keep failing wakes you once per streak with `working, <n> tool calls failed in a row`; one idle 20 minutes whose `status:` is neither `ready-for-host` nor `blocked` wakes you once with `idle <n>m at <status>, stalled`, and `{{cli}} ls` marks it `stalled`. Each wake is a `{{cli}} peek`, then either a steer that names what to stop or the end of the turn.

- A container stopped by a model or network error wakes you with `<prev> -> stopped on an error`; one closed with `{{cli}} down` wakes nothing more.
- One stopped by the account limit is resumed by the watch with the stock continue, at the reset time its message gives, else every 30 minutes up to 10 times; if none takes, it wakes you once with `stopped on the account limit, 10 resumes did not take`.

A settling agent whose `status.md` or branch facts changed since its previous wake wakes you with `[fleet] <agent>: <sandbox> <prev> -> <status>`, the sandbox named only where herdr shortened the agent, then:

- a short projection of `status.md`: status, attention, next step, the number of new `## Log` entries
- the branch's facts: commits since the merge base with origin's default branch, pushed and unpushed, files and lines changed, the latest commit, and the pull request with its CI
- its activity from `logs/activity.jsonl`: time up, minutes silent, tool calls, last tool, failures in a row and cost so far
- for a container at `status: blocked` that goes on calling tools, `still working while blocked: <n> tool calls since status.md turned blocked`, and `{{cli}} ls` marks it `<n> tool calls since blocked`: it spends while it waits on you, so answer its `attention:` or steer it to stop

`{{cli}} ls` shows the same facts and activity per container. A turn that ends with the pull request open and its CI running is not a settle and wakes nothing; the settle after CI ends does. Each container wakes independently. The message points into durable task state; `status.md` remains canonical.

The wake turn is one line, the agent and its change, then either the next steer when the task is yours to drive or the end of the turn. Going back to work is silent.
