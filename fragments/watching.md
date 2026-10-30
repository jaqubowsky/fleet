{{watch.source}}

A watched container settling in Herdr app (`idle`, `done`, `blocked` on a dialog, or `error`) wakes you once per settle with `[fleet] <sandbox>: <state>` and the last message of its newest session transcript: its closing message, or the error that stopped it. One working 20 minutes without settling wakes you with `working <n>m without settling` and its last message, then every 15 minutes while that message stays the same.

The wake turn is one line, the agent and what its message says, then either the next steer or the end of the turn. A `working` wake carries the last thing the container said, which can be old, so it gets `{{cli}} peek` before that line.
