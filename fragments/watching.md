{{watch.owner}} `fleet_watch <sandbox...>`, or `/fleet-watch [names]` typed by the user, explicitly watches containers regardless of ownership, by the sandbox name `{{cli}} ls` prints; no name watches every container.

A watched container working on without settling wakes you with `working <n>m without settling`, and again while it goes on. That wake is a `{{cli}} peek`, then either a steer that names what to stop or the end of the turn.

- A fleet wake is a follow-up turn after the current run settles, not context saved for the next user prompt.
- A container stopped by a model or network error wakes you with `<prev> -> stopped on an error`; one closed with `{{cli}} down` wakes nothing more.
- A settling agent whose `status.md` changed since its previous wake wakes you with `[fleet] <name>: <prev> -> <status>`, then a short projection of `status.md`: status, attention, next step, the number of new `## Log` entries, and the latest commit on this branch since its upstream. Each container wakes independently. The message points into durable task state; `status.md` remains canonical. The wake turn is one line, the agent and its change, then either the next steer when the task is yours to drive or the end of the turn. Going back to work is silent.
