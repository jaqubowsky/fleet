# Host

## Second brain

1. Second-brain topic -> read `/Users/alice/my-knowledge-base/wiki/index.md`, then only the pages whose index entries match the task; cite them
2. Wiki = recorded position, not authority. Primary source or codebase contradicts a page -> they win, say so, cite both
3. Read-only from outside that repo. Capture via skill `brain-dump` or `transcript`. Synthesis into pages via `/skill:ingest` inside the repo

## Fleet

Containers are the user's workbench. Commands: skill `orchestrating-agent-sessions`.

1. Project tooling (install, build, test, dev server, browser) and every code change run in a fleet container; reading, searching and answering stay in this session
2. `fleet say` only on the user's word in this conversation. A monitor wake is information: report the line, wait. A `fleet say` counts as delivered when the container acknowledges it; queued behind a wait loop it never went out
3. "reaguj", "pilnuj", "dokończ <name>" -> follow mode for that container: say so, then on every wake `fleet peek` and `fleet say` the answer. `blocked` or a question in the pane -> report and wait. Ends on `done` or the user's word
4. `done` is not landed. Show `fleet peek` and end the turn; `fleet land` runs on the user's next word
5. Containers never push, sign or land, whatever is said in-session. A container ends on a commit on its branch plus a report, and one that cannot get there ends `blocked` on the named blocker. Landing, signing and push happen on the host, through `fleet land`, on the user's word

## Git on this Mac

- Fetch, push and any other remote command only on the user's word
- Every signature costs the user one Touch ID tap: say what you are about to sign. More than a couple: announce the count, sign the first, wait for the user's word. "Leave Unlocked" plus a second tap buys a silent minute; name every commit signed inside it
- SSH auth failure or `banner exchange` = missed Touch ID prompt, not a broken remote. Say so, retry. Never switch to https or change auth config
