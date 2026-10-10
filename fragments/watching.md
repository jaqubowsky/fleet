{{watch.source}}

A watched container settling in herdr (`idle`, `done`, or `blocked` on a dialog) wakes you once per settle with `[fleet] <agent>: <sandbox> <label>`, the sandbox named only where herdr shortened the agent, and the last 15 lines of its pane. The watch reads the label from the container's closing message:

| Label | The closing message | Your turn |
| --- | --- | --- |
| `question` | has a `Question:` line other than `none` | answer it in a steer, or ask the user when the decision is theirs |
| `turn ended` | ends `Question: none` | the next steer when the task is yours to drive, else end the turn |
| `no closing message` | is missing: an error, an interruption, a crash, a dialog | `{{cli}} peek`, then a steer that names what to do |

- A container working 20 minutes without settling wakes you with `working <n>m without settling`, and again while it goes on
- One taken down, by `{{cli}} down` from any session or by its sandbox leaving `sbx ls`, wakes you once with `<prev> -> taken down`; a closed pane, with `<prev> -> gone`
- One stopped by the account limit is resumed by the watch with the stock continue, at the reset time its pane gives, else every 30 minutes up to 10 times; if none takes, it wakes you once with `stopped on the account limit, 10 resumes did not take`
- The same label wakes you at most twice between two steers

`{{cli}} ls` shows each container's branch, dirty count, commits since the merge base with origin's default branch, and its activity. The wake turn is one line, the agent and its label, then either the next steer or the end of the turn. Going back to work is silent.
