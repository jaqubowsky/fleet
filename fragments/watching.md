{{watch.source}}

A watched container settling in herdr (`idle`, `done`, or `blocked` on a dialog) wakes you once per settle with `[fleet] <agent>: <sandbox> <state>`, the sandbox named only where herdr shortened the agent, and the last message of its newest session transcript: its closing message, or the error that stopped it.

- A container working 20 minutes without settling wakes you with `working <n>m without settling` and its last message, unless that message is new since your last wake about it; after that, each 15 minutes in which its message stays the same wakes you
- A sleep of this Mac wakes you once with `[fleet] watch: this Mac slept from <time> to <time> while <containers> worked`; the sleep does not count as working time
- One taken down by `{{cli}} down` from another session, or by its sandbox leaving `sbx ls`, wakes you once with `<prev> -> taken down`; a closed pane, with `<prev> -> gone`
- Between two steers, an `idle` or `done` whose message its last wake already carried, as after compacting while idle, does not reach you

The wake turn is one line, the agent and what its message says, then either the next steer or the end of the turn. A `working` wake carries the last thing the container said, which can be old, so it gets `{{cli}} peek` before that line. Going back to work is silent.
