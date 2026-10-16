{{watch.source}}

A watched container settling in herdr (`idle`, `done`, or `blocked` on a dialog) wakes you once per settle with `[fleet] <agent>: <sandbox> <state>`, the sandbox named only where herdr shortened the agent, and the last message of its newest session transcript: its closing message, or the error that stopped it.

- A container working 20 minutes without settling wakes you with `working <n>m without settling` and the last thing it said, and again while it goes on
- One taken down by `{{cli}} down` from another session, or by its sandbox leaving `sbx ls`, wakes you once with `<prev> -> taken down`; a closed pane, with `<prev> -> gone`
- Between two steers, an `idle` or `done` whose message its last wake already carried, as after compacting while idle, does not reach you, and the same state reaches you at most twice

The wake turn is one line, the agent and what its message says, then either the next steer or the end of the turn. A `working` wake whose message shows the work moving ends the turn without a word; one showing an error, a wait on a person, or its last wake's message gets `{{cli}} peek` before that line. Going back to work is silent.
