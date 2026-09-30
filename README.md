# harness

My agent setup, published as it runs on my Mac. Two coding agents, [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) and Claude Code, share one set of rules, skills and safety checks. I talk to one agent on my Mac, the host. It plans the work and hands each task to another agent in its own sandboxed container, watches it, and brings the finished branch home. Containers never hold my keys, so every commit that reaches GitHub is signed on my Mac.

It is opinionated and not plug-and-play: both pi and Claude Code are required, it runs only on Apple Silicon Macs, and it encodes how I work. Read it for the ideas, or fork it and let your own agent adapt it with [SETUP.md](SETUP.md).

| | |
| --- | --- |
| Built in | 366 commits over two weeks, 16 to 30 September 2026 |
| Code | 7.8k lines of TypeScript in `src/`, 13.6k lines of tests |
| Guard | 424 test cases of what the agents may and may not run |
| Skills | 19, written once for both agents |

## How it works

Everything is written once in this repository and rendered into two places per agent. The host seat is the agent's home on the Mac (`~/.pi`, `~/.claude`). The container seat is the image every task container starts from. A rule says `{{token}}` where the two agents need different words, such as their tool names, and render fills it in. My own values (which repositories I work on, what each seat may do there, my git identity for containers) live outside the repository in `~/.config/harness/`.

![Architecture](docs/architecture.svg)

A task runs in a container: a private clone of the repository in a [Docker Sandbox](https://docs.docker.com/ai/sandboxes/install/) (`sbx`), with its agent in a [herdr](https://github.com/herdrdev/herdr) tab. The host and the container share one task directory. The container writes its analysis, its tickets, its review and its state there; the host reads `status.md` and wakes each time the container's agent settles. When the work is done, the host lands the branch: it fetches it from the sandbox, signs it and pushes it, as far as the repository's profile allows.

![A task's lifecycle](docs/lifecycle.svg)

Inside the container the agent follows one order: analyze the task, split it into tickets of one commit each, build each ticket test first, review what needs a second pair of eyes, verify what a user would see, and stop at `ready-for-host`. When it needs a decision, it stops at `blocked` and says what it needs. The host plans across containers in the issue tracker a project names: one issue per container, the container's own tickets one commit each.

Every tool call on the host passes the guard first. The same policy runs in pi's extension and in Claude Code's `PreToolUse` hook, and a test corpus in `host/tests/` holds the cases it must allow and refuse.

![How the guard decides](docs/guard.svg)

Repeat `--repo <path>` on `fleet up` for a task spanning several repositories. The first is primary; each additional clone is built from a Git bundle inside the sandbox, never a writable host mount. `land` preflights every repository before any host branch moves, and an interrupted land resumes on a rerun without force.

## Commands

`fleet` drives pi and Claude containers alike, from either host agent. `fleet --help` lists every flag.

| Command | What it does |
| --- | --- |
| `fleet up <label> [--repo <path>...] [--pi\|--claude]` | clone the repositories into a new sandbox, lay out the task directory, start the agent in a herdr tab |
| `fleet steer <sandbox> <text>` | send the container's agent a message |
| `fleet watch [<sandbox>...]` | print a line each time a container settles; pi's host does this in process |
| `fleet ls`, `fleet peek <sandbox>` | every container with its state; one container's branch, diff and screen |
| `fleet land <sandbox> [--sign] [--push]` | fetch the branch from the sandbox, sign it per profile, push fast-forward only |
| `fleet down <sandbox>` | record usage and memory, close the tab, remove the container; the task directory stays |
| `fleet build [--pi\|--claude]` | render the container seat and rebuild that agent's image |
| `fleet render`, `./sync.sh [--apply]` | render the host seat; bring every home, link, setting and image in line with this repository |
| `fleet profile [<repo>] [--apply]` | print what each seat may do in a repository; set a checkout up for it |
| `fleet handoff`, `history`, `artifacts`, `exec`, `copy`, `init` | approve a session handoff, read a task's status history and files, run or copy into a container, seed a new project |

The host session names itself in `FLEET_SEAT`: Claude Code through the `env` of its settings, pi through its fleet monitor. `up`, `steer`, `watch` and `render` refuse without it.

## Permission profiles

What each seat may do in a repository is its profile: `~/.config/harness/repos.json`, matched by `owner/repo`, then `owner/*`, then the `*` of `host/repos.json`. Agents read profiles and the guard refuses them any write to one. `fleet profile <repo>` prints the one that applies.

| Field | Seat | Levels | What it governs |
| --- | --- | --- | --- |
| `sign` | host | `none`, `human`, `auto` | whether `land` signs the commits origin lacks; `human` is one Touch ID tap per commit |
| `push` | host, container | `none`, `human`, `auto` | who pushes the branch; a container at `auto` pushes its own branch with a token that sees no other private repository |
| `pr` | host, container | `none`, `human`, `auto` | who opens the pull request |
| `merge` | host | `none`, `human`, `auto` | whether the host merges; containers never merge |
| `down` | host | `none`, `human`, `auto` | whether the host removes a container on its own |
| `linear` | host, container | `none`, `read`, `write` | access to the Linear server the profile names |
| `token` | container | `env:<NAME>`, `op://…` | the GitHub token bound into the container, from the host session's environment or 1Password |
| `resources` | container | memory, cpus | the sandbox's size |

`none` never, `human` after the person confirms, `auto` without asking. A host that signs at `human` cannot go with a container that pushes at `auto`: unsigned commits would reach GitHub first. The default `*` profile lets the container open pull requests and leaves signing, pushing and removing containers to the person.

## Layout

| Path | What |
| --- | --- |
| `rules/` | global rules; `{{token}}` marks the words that differ per harness |
| `rules/refs/` | what rules and skills point to: the task directory contract, testing, reading CI, the ticket template |
| `templates/project/` | the seed `init` lays into a new project: `AGENTS.md` and `spec/vision.md` |
| `skills/` | `shared/` renders into both seats, `host/` into the host seat, `container/` into the image |
| `agents/` | read-only sub-agents `explorer`, `researcher`, `reviewer`; each harness adds their frontmatter as `fragments/agent-<name>.md` |
| `fragments/` | text a harness can replace with its own `<harness>/fragments/<name>.md` |
| `src/harness.ts` | every value that differs per harness: the seat, the host session running `fleet`, and the kind, the agent a container runs |
| `src/render/` | renders rules, skills, agents and settings for one harness and seat |
| `src/fleet/` | the fleet CLI behind `fleet` |
| `src/guard/` | the tool-call policy both hosts enforce, tested against the case corpus in `host/tests/` |
| `src/remote/` | the pi phone remote, see `extensions/pi-remote/README.md` |
| `src/statusline/` | the status line pi and Claude draw: folder, branch, model, context bar toward the 250k handoff, usage limits |
| `extensions/` | pi extensions: fleet monitor, guard, session handoff, error handoff, status history, state relay, statusline, phone remote |
| `sbx/` | `build.sh`, the container rule `sandbox.md`, `base-worktree`, `ticket-check` and `toolchain.Dockerfile`, which every `<harness>/sbx/Dockerfile` pulls in at `{{toolchain}}` |
| `host/` | herdr config and pi screen rules, the no-ssh-agent kit, the guard corpus and test runner |
| `host/repos.json` | the `*` profile, the one a repository your own profiles omit gets |
| `host/projects/template.md` | the headings of a per-repository overlay |
| `pi/`, `claude/` | per-harness profiles, model seats, themes, host extension entry or hooks, kit, image; `claude/profiles/host.json` is the Claude host's settings |
| `docs/` | the diagrams in this README |
| `bin/` | `fleet`, the one CLI both hosts run |
| `sync.sh` | brings every home, link, image and setting in line with this repository; prints the plan, `--apply` makes it; ends with what a new Mac lacks that it cannot set up, under `== set up by hand` |
| `SETUP.md` | setting a Mac up from a fresh clone, written for an agent: tokens, model logins, network policy |

The homes hold only rendered files and runtime state. Edit here and run `./sync.sh --apply`, never edit a home. Render replaces the directories listed in `OWNED` in `src/render/render.ts` whole, so a file removed here disappears there too.

## pi and Claude Code side by side

| Concern | pi | Claude Code | Why |
| --- | --- | --- | --- |
| Waking the host | `extensions/fleet-monitor.ts` runs `src/fleet/watch.ts` in process and triggers a turn per wake | `fleet watch` runs the same `watch.ts`, held with `Monitor` | Claude Code has no API for an extension to start a turn |
| Which containers wake it | the ones this session put up or steered, by `PI_SESSION_ID`; more with `/fleet-watch` | the ones this herdr pane put up or steered last; more by name on `fleet watch` | same as above |
| Agent state in herdr | `fleet relay` in the pane reports as `fleet:pi` | herdr reads Claude's screen | herdr's Claude integration reports only the session |
| Guard | extension, pi tool names translated | `PreToolUse` hook in `~/.claude/settings.json`, fails closed | where each agent lets code intercept a tool call |
| Session handoff | suggested in `status.md` at natural breaks; a `turn_end` note at 250k tokens and every 100k after; `/session-handoff` opens the fresh session | same suggestion; a `PostToolUse` hook at the same thresholds; `/clear` from the user or host, recorded by a `SessionStart` hook | Claude Code cannot replace a session from inside it |
| Error handoff | `agent_end` with `stopReason: error` | `StopFailure` hook | each agent's own error event |
| Status history into `logs/status.jsonl` | `tool_execution_end` | `PostToolUse`, `Stop` and `StopFailure` hooks | each agent's own after-tool event |
| Transcripts in `logs/sessions/` | written as they happen | copied out by `fleet down` | Claude Code has no session directory setting |
| Activity in `logs/activity.jsonl`, cost so far in wakes and `ls` | `tool_execution_end`; cost from `logs/sessions` | `PostToolUse` and `PostToolUseFailure` hooks; cost from `src/fleet/usage.ts` run in the container over its transcripts | Claude transcripts stay in the container until `fleet down` |
| Cost in `logs/usage.json` | the session's own cost records | computed from tokens with the price table in `src/fleet/usage.ts` | Claude transcripts carry tokens, not cost |
| Statusline | `extensions/statusline.ts` with `src/statusline/` | `claude/statusline.mjs` with `src/statusline/` | Claude Code runs a command |
| Models | seats in `pi/profiles/models.json` | seats in `claude/profiles/models.json`, `effort` per agent | `CLAUDE_CODE_SUBAGENT_MODEL` stays unset, see `SETUP.md` |
| Phone control | `extensions/pi-remote` | Remote Control, a product setting | Claude Code ships its own |
| Host sandbox | none | macOS sandbox from `claude/profiles/host.json` | only Claude Code has one |

## Checks

```bash
npm test          # node --test over src/, the guard corpus, skills load, extension checks, the settings aligner
npm run check     # tsc --noEmit
```

## Trust model

![Trust model](docs/trust.svg)

Every signature comes from the Mac. Containers get no SSH agent and no signing key. Credentials reach them only through the sbx proxy, which holds the GitHub token and the model logins host-side and adds them to outgoing requests; the container sees placeholders. Containers commit unsigned on their task branch. Pushes come from the Mac at the host's `push` level, or from a container whose profile gives it `push: auto`, with a token `up` refuses if it sees any other private repository.

`land` fetches every repository through the sandbox's git remote and checks each before any host branch moves: a clean container on the recorded branch, history that descends from the saved base, and a branch checked out in no host worktree. Signing re-creates only the commits origin lacks, keeping tree, author and message. `--push` refuses anything that is not a fast-forward. Force, delete and mirror pushes and turning signing off stay the person's own commands, and the guard refuses them on every host.

The limits, plainly:

- The guard matches patterns, not shell semantics: `eval` and variable indirection get past it. It stops mistakes and simple malicious code, not someone who has read the rule.
- The Claude guard is a user-level hook in `~/.claude/settings.json`. Claude Code merges hooks across settings scopes, and a repository's own `.claude/settings.json` can set `disableAllHooks`, which turns user-level hooks off. Open an untrusted repository in the host session and its settings can switch the guard off. Managed settings would prevent that and need an admin install per Mac; this setup trades that for a clone-and-sync setup.
- Every container a profile covers receives that profile's token. The default `*` profile hands every container the host session's `GH_TOKEN`, so scope it to the repositories you work on.
- The guard refuses any write into `~/.pi` and `~/.claude` except the runtime state agents write there; reads pass only through the Read, Grep and Glob tools and a short list of read commands.
- Every container runs with `CI=true`, so test runners run once instead of watching. Snapshots fail instead of updating.

## Credits

The code smell list the reviewer works from is adapted from [mattpocock/skills](https://github.com/mattpocock/skills), MIT; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE)
