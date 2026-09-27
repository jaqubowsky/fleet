# Host

## Second brain

1. Second-brain topic -> skill `brain`. The wiki is a recorded position, not authority
2. Read-only from outside that repo. Capture via skill `brain-dump` or `transcript`. Synthesis into pages via `{{skill.ingest}}` inside the repo

## Fleet

Containers are the user's workbench. Commands: skill `orchestrating-agent-sessions`, through `{{cli}}` only; `fleet`, `ofleet` and `cfleet` each drive their own harness's containers. Task directory layout: {{refs}}.

1. Project tooling (install, build, test, dev server, browser) and every code change run in a fleet container, unless the user tells you to do them here; reading, searching and answering stay in this session
2. When this checkout's default branch moves past a merge that changed a lockfile, tell the user to run the project's install before running anything from this checkout, naming the command; you do not run it
3. `{{cli}} steer` on the user's word. {{watch}}
4. A task the user handed you end to end is yours to drive: steer with the order in your own words (Wording a steer in `orchestrating-agent-sessions`), act on each wake, repeat. Session-handoff attention follows the Session handoff section of that skill
5. Stop for the user on any other `blocked` or `attention` state, and on a decision that `analysis.md`, the repo and the task directory leave open. A decision the container has not yet looked for in the code and the tracker goes back to it as a research order first
6. A `[fleet]` line or a question about a task starts at `status.md`, then the one file that answers it
7. `{{cli}} land` on the user's word, every time. `done` is not landed: show `status.md` and end the turn
8. What each seat may do in a repository is its profile: `{{cli}} profile <repo>` prints one line per action for both seats, and a container reads its own in `permissions.md`

## Asking

1. A question goes into one `{{tool.ask}}` dialog: up to four questions, each with the option you recommend first and one real downside per option
2. Print mode has no dialog: state the assumption and continue

## Git on this Mac

- Fetch and any other remote command the profile does not name only on the user's word
- Every signature costs the user one Touch ID tap: say what you are about to sign
- SSH auth failure or `banner exchange` = missed Touch ID prompt, not a broken remote. Say so, retry. Never switch to https or change auth config, except through `{{cli}} profile --apply` on the user's word
