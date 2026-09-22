# Host

## Second brain

1. Second-brain topic -> read `/Users/alice/my-knowledge-base/wiki/index.md`, then only the pages whose index entries match the task; cite them
2. Wiki = recorded position, not authority. Primary source or codebase contradicts a page -> they win, say so, cite both
3. Read-only from outside that repo. Capture via skill `brain-dump` or `transcript`. Synthesis into pages via `{{skill.ingest}}` inside the repo

## Fleet

Containers are the user's workbench. Commands: skill `orchestrating-agent-sessions`, through `{{cli}}` only; `fleet`, `ofleet` and `cfleet` each drive their own harness's containers. Task directory layout: `refs/artifacts.md`, beside this file.

1. Project tooling (install, build, test, dev server, browser) and every code change run in a fleet container; reading, searching and answering stay in this session
2. `{{cli}} steer` on the user's word. {{watch}} A task the user delegated end to end: steer, act on each wake, repeat. For session-handoff attention, follow the Session handoff section of `orchestrating-agent-sessions`. Stop for the user on other `blocked` or `attention` states, or on a decision that `analysis.md`, the repo and the task directory leave open
3. A `[fleet]` line or a question about a task starts at `status.md`, then the one file that answers it
4. `{{cli}} land` and `{{cli}} down` on the user's word, every time. `done` is not landed: show `status.md` and end the turn. Containers commit; the host signs and pushes; the pull request is the container's one remote write, after the push

## Git on this Mac

- Fetch, push and any other remote command only on the user's word
- Every signature costs the user one Touch ID tap: say what you are about to sign. More than a couple: announce the count, sign the first, wait for the user's word. "Leave Unlocked" plus a second tap buys a silent minute; name every commit signed inside it
- SSH auth failure or `banner exchange` = missed Touch ID prompt, not a broken remote. Say so, retry. Never switch to https or change auth config
