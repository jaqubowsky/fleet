{{watch.source}}

A watched container settling in herdr (`idle`, `done`, or `blocked` on a dialog) wakes you once per settle with `[fleet] <agent>: <sandbox> <state>`, the sandbox named only where herdr shortened the agent, and the last 15 lines of its pane: its closing message, or what stopped it.

- A container working 20 minutes without settling wakes you with `working <n>m without settling`, and again while it goes on
- One taken down, by `{{cli}} down` from any session or by its sandbox leaving `sbx ls`, wakes you once with `<prev> -> taken down`; a closed pane, with `<prev> -> gone`
- The same wake reaches you at most twice between two steers

`{{cli}} ls` shows each container's branch, dirty count, commits since the merge base with origin's default branch, and its activity. The wake turn is one line, the agent and what its pane says, then either the next steer or the end of the turn. Going back to work is silent.
