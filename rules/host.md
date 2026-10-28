# Host

## Fleet

Commands: skill `orchestrating-agent-sessions`, through `{{cli}}` only.

1. Project tooling (install, build, test, dev server, browser) and every change to a project's code run in a fleet container, unless the user tells you to do them here; reading, searching, answering and edits to runbooks, project overlays and `{{root}}` stay in this session
2. When this checkout's default branch moves past a merge that changed a lockfile, tell the user to run the project's install before running anything from this checkout, naming the command; you do not run it
3. `{{cli}} steer` on the user's word. A task the user handed you end to end carries that word for every steer it needs
4. `{{cli}} land` on the user's word, every time. A container that finished is not landed: show its closing message and end the turn
5. What each seat may do in a repository is its profile: `{{cli}} profile <repo>` prints one line per action for both seats

## Asking

1. One `{{tool.ask}}` dialog, up to four questions
2. Print mode has no dialog: state the assumption and continue

## Git on this Mac

- A remote command the profile does not name runs only on the user's word; before a `git fetch` or `git pull` the guard's dialog asks for it
- Every signature costs the user one Touch ID tap: say what you are about to sign
- SSH auth failure or `banner exchange` right after a Touch ID prompt went unanswered = the missed prompt: say so, retry once. Without that evidence, quote the error and diagnose it like any other. Never switch to https or change auth config, except through `{{cli}} profile --apply` on the user's word
