{{watch.owner}} `fleet_watch <sandbox...>`, or `/fleet-watch [names]` typed by the user, explicitly watches containers regardless of ownership, by the sandbox name `{{cli}} ls` prints; no name watches every container.

A watched container working on without settling wakes you with `working <n>m without settling`, and again while it goes on; one whose tool calls keep failing wakes you once per streak with `working, <n> tool calls failed in a row`; one idle 20 minutes whose `status:` is neither `ready-for-host` nor `blocked` wakes you once with `idle <n>m at <status>, stalled`, and `{{cli}} ls` marks it `stalled`. Each wake is a `{{cli}} peek`, then either a steer that names what to stop or the end of the turn.

- A fleet wake is a follow-up turn after the current run settles, not context saved for the next user prompt.
- A container stopped by a model or network error wakes you with `<prev> -> stopped on an error`; one closed with `{{cli}} down` wakes nothing more.

A settling agent whose `status.md` or branch facts changed since its previous wake wakes you with `[fleet] <agent>: <sandbox> <prev> -> <status>`, the sandbox named only where herdr shortened the agent, then:

- a short projection of `status.md`: status, attention, next step, the number of new `## Log` entries
- the branch's facts: commits since the merge base with origin's default branch, pushed and unpushed, files and lines changed, the latest commit, and the pull request with its CI
- its activity from `logs/activity.jsonl`: time up, minutes silent, tool calls, last tool, failures in a row and cost so far

`{{cli}} ls` shows the same facts and activity per container. A turn that ends with the pull request open and its CI running is not a settle and wakes nothing; the settle after CI ends does. Each container wakes independently. The message points into durable task state; `status.md` remains canonical.

The wake turn is one line, the agent and its change, then either the next steer when the task is yours to drive or the end of the turn. Going back to work is silent.
