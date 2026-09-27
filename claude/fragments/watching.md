Nothing watches a container by itself here: Claude Code has no extension that can start a turn, so the wake is `cfleet watch`, held with `Monitor` at `timeout_ms: 1800000`, its maximum. Start it before the first steer and keep one per session; its expiry notice, and a notice that it stopped with an earlier session, is the re-arm, before anything else. With no names it follows the containers whose latest `cfleet up` or `cfleet steer` came from this herdr pane, drops one at its `cfleet down`, and picks up new ones within 30 seconds; names add those sandboxes beside them, whoever put them up. Its first line is `[fleet] watching ...`; a Monitor that never printed it never subscribed, so restart it.

A watched container working on without settling prints `working <n>m without settling`, and again while it goes on; one whose tool calls keep failing prints `working, <n> tool calls failed in a row` once per streak; one idle 20 minutes whose `status:` is neither `ready-for-host` nor `blocked` prints `idle <n>m at <status>, stalled` once, and `cfleet ls` marks it `stalled`. Each line is a `cfleet peek`, then either a steer that names what to stop or the end of the turn.

- A container stopped by a model or network error prints `<prev> -> stopped on an error`; one closed with `cfleet down` prints nothing more.

A settling agent whose `status.md` or branch facts changed since its previous wake prints `[fleet] <agent>: <sandbox> <prev> -> <status>`, the sandbox named only where herdr shortened the agent, then:

- a short projection of `status.md`: status, attention, next step, the number of new `## Log` entries
- the branch's facts: commits since the merge base with origin's default branch, pushed and unpushed, files and lines changed, the latest commit, and the pull request with its CI
- its activity from `logs/activity.jsonl`: time up, minutes silent, tool calls, last tool, failures in a row and cost so far

`cfleet ls` shows the same facts and activity per container. A turn that ends with the pull request open and its CI running is not a settle and prints nothing; the settle after CI ends does. Each container reports independently. The message points into durable task state; `status.md` remains canonical.

The wake turn is one line, the agent and its change, then either the next steer when the task is yours to drive or the end of the turn. Going back to work is silent.
