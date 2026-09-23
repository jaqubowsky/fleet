{{watch.owner}} `fleet_watch <sandbox...>`, or `/fleet-watch [names]` typed by the user, explicitly watches containers regardless of ownership, by the sandbox name `{{cli}} ls` prints; no name watches every container.

A watched container working on without settling wakes you with `working <n>m without settling`, and again while it goes on. That wake is a `{{cli}} peek`, then either a steer that names what to stop or the end of the turn.

- A fleet wake is a follow-up turn after the current run settles, not context saved for the next user prompt.
- A settling agent wakes you with `[fleet] <name>: <prev> -> <status>`, then a bounded projection of `status.md`: status, attention, summary, next step, followed by recent commits. Each container wakes independently. The message points into durable task state; `status.md` remains canonical. The wake turn is one line, the agent and its change, then either the next steer when the task is yours to drive or the end of the turn. Going back to work is silent.
- `blocked` means a dialog waits for the user in that tab. `gone` means the pane or tab closed, and `working -> unknown` usually means {{harness}} died in it; read the tab.
- Steer, then the wake: the same sequence for a container you watch and one you drive end to end.
