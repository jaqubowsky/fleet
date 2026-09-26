# Host

## Second brain

1. Second-brain topic -> read `/Users/alice/my-knowledge-base/wiki/index.md`, then only the pages whose index entries match the task; cite them
2. Wiki = recorded position, not authority. Primary source or codebase contradicts a page -> they win, say so, cite both
3. Read-only from outside that repo. Capture via skill `brain-dump` or `transcript`. Synthesis into pages via `{{skill.ingest}}` inside the repo

## Fleet

Containers are the user's workbench. Commands: skill `orchestrating-agent-sessions`, through `{{cli}}` only; `fleet`, `ofleet` and `cfleet` each drive their own harness's containers. Task directory layout: {{refs}}.

1. Project tooling (install, build, test, dev server, browser) and every code change run in a fleet container, unless the user tells you to do them here; reading, searching and answering stay in this session
2. `{{cli}} steer` on the user's word. {{watch}} A task the user handed you end to end is yours to drive: steer with the order in your own words (Wording a steer in `orchestrating-agent-sessions`), act on each wake, repeat. For session-handoff attention, follow the Session handoff section of `orchestrating-agent-sessions`. Stop for the user on other `blocked` or `attention` states, or on a decision that `analysis.md`, the repo and the task directory leave open; a decision the container has not yet looked for in the code and the tracker goes back to it as a research order first
3. A `[fleet]` line or a question about a task starts at `status.md`, then the one file that answers it
4. `{{cli}} land` and `{{cli}} down` on the user's word, every time. `done` is not landed: show `status.md` and end the turn. Who signs, pushes, opens and merges pull requests in a repository is its profile: `{{cli}} profile <repo>` prints both seats' levels, and a container reads its own in `permissions.md`

## Git on this Mac

- Push, `gh pr create` and `gh pr merge` as `{{cli}} profile <repo>` says for the host seat. Fetch and any other remote command only on the user's word
- Every signature costs the user one Touch ID tap: say what you are about to sign
- SSH auth failure or `banner exchange` = missed Touch ID prompt, not a broken remote. Say so, retry. Never switch to https or change auth config, except through `{{cli}} profile --apply` on the user's word
