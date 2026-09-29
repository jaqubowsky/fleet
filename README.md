# harness

One source for two agent harnesses on this Mac: pi and Claude Code. Each one runs a host session plus one container per task. A container is a private clone in an sbx sandbox with the agent waiting in a herdr tab. The host session puts containers up, watches them and brings their branches home. It prompts a container only when told to.

Rules, skills, sub-agents, the guard policy, the fleet CLI and the container setup are written once. `pi/` and `claude/` hold only what one harness cannot share: its settings, its extension or hook wiring, its image and kit, and the text fragments that name its own tools.

## Architecture

The repository renders into two seats per harness. The host seat is the harness home on this Mac. The container seat is the image every task container starts from.

```text
                   ~/harness, the only place to edit
 ┌──────────────────────────────────────────────────────────────────┐
 │ written once                        per harness                  │
 │   rules/  rules/refs/  agents/        pi/  claude/               │
 │   skills/{shared,host,container}/     settings, hooks, kit,      │
 │   fragments/  extensions/  src/       image, own fragments       │
 │   sbx/container/                                                 │
 │                                                                  │
 │ src/harness.ts: CLI, sandbox prefix, image, flags, {{tokens}}    │
 └────────────────────────────────┬─────────────────────────────────┘
                                  │ src/render/
                ┌─────────────────┴──────────────────┐
                ▼                                    ▼
   host seat                            container seat
   ./sync.sh --apply, fleet render      fleet build, then sbx/build.sh
   ~/.pi  ~/.claude                     my-pi:v1  my-claude:v1
   rules/ with host.md                  rules/ without host.md, + sandbox.md
   skills/shared + skills/host          skills/shared + skills/container
```

At runtime the host and a container share one task directory and talk through herdr and git. The container's code reaches the host only through `land`, and its reports only through the task directory.

```text
            this Mac                                   sbx sandbox, one per task
 ┌────────────────────────────────┐              ┌────────────────────────────────┐
 │ host session                   │  up, steer   │ agent in a herdr tab           │
 │ pi or claude                   │ ───────────▶ │ private clone, task branch     │
 │                                │              │ no SSH agent, no signing key   │
 │ fleet watch                    │ herdr state  │                                │
 │   herdr socket + status.md     │ ◀─────────── │ working, blocked, done         │
 │   = one [fleet] line per wake  │              │                                │
 │                                │  git remote  │                                │
 │ fleet land --sign --push       │ ◀─────────── │ unsigned commits               │
 │   Touch ID signs, pushes ff    │ sandbox-<n>  │                                │
 └───────────────┬────────────────┘              └───────────────┬────────────────┘
                 │                                               │
                 │     ~/.sandboxes/<repo>/<sandbox>/            │
                 └───▶ task directory, $FLEET_ARTIFACTS  ◀───────┘
                       status.md  analysis.md  review.md  logs/
```

A task moves through the run order in `sbx/container/sandbox.md`, and `status.md` carries its state. The host wakes each time the container's agent settles, except while its pull request's CI runs and it is neither `blocked` nor `paused`, and again when it works long without settling, sits idle long short of `ready-for-host`, `paused` or `blocked`, or its tool calls keep failing; every tool call lands in `logs/activity.jsonl`, which each wake and `fleet ls` project.

```text
 up ─▶ steer ─▶ analyze-task ─▶ to-tickets ─▶ per ticket: implement + tdd, gate,
 new            analyzing                     review by blast radius, one commit
                                              implementing, reviewing
                                                          │
 down ◀── land ◀── ready-for-host ◀── verification ◀──────┘
 logs/usage.json,  --sign, --push     testing
 memory.json
 task dir stays

 blocked at any step: attention: names what the person has to decide
```

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
| `host/repos.json` | the `*` profile, the one a repository your own profiles omit gets (User config) |
| `host/projects/template.md` | the headings of a per-repository overlay (User config) |
| `pi/`, `claude/` | per-harness profiles, model seats, themes, host extension entry or hooks, kit, image |
| `bin/` | `fleet`, the one CLI both hosts run |
| `sync.sh` | brings every home, link, image and setting in line with this repository; prints the plan, `--apply` makes it; ends with what a new Mac lacks that it cannot set up, under `== set up by hand` |
| `inventory.md` | what lives outside this repo: tokens, MCP servers, model logins, network policy |
| `BOOTSTRAP.md` | setting this Mac up from nothing |

The homes hold only rendered files and runtime state. Edit here and run `./sync.sh --apply`, never edit a home. Render replaces the directories listed in `OWNED` in `src/render/render.ts` whole, so a file removed here disappears there too.

## User config

What names your own repositories lives outside this repository, in `~/.config/harness/`:

- `repos.json`: your repository permission profiles, the same shape as `host/repos.json`. An entry here wins over the harness's for the same match; a repository no entry matches gets the harness's `*`
- `projects/<owner>/<repo>.md`: the overlay of one repository, holding only what the repository, the tracker and the profile do not say themselves. `up` writes it into the task directory as `project.md` and runs the one `sh` block under `## Setup` in the container after the dependency install. `host/projects/template.md` holds the headings

Agents read both and the guard refuses them any write to either `repos.json`. A profile's `host.linearServer` reaches only the checkouts you register it in: `fleet profile <checkout> --apply` adds it for that directory alone, Claude through `claude mcp add --scope local`, pi in the checkout's `.pi/mcp.json`, kept out of git by `.git/info/exclude`. Run it once per harness you use there.

Moving from the old paths, before you pull this change:

1. `mkdir -p ~/.config/harness/projects`
2. `jq 'del(.["*"])' host/repos.json > ~/.config/harness/repos.json`; keep `*` too if yours differs from the harness's
3. `mv host/projects/*/ ~/.config/harness/projects/`, which leaves `template.md` behind
4. `git checkout host/repos.json && git pull`, then `./sync.sh --apply`: the render and the settings aligner take every host Linear server out of `~/.<harness>/agent/mcp.json` and `managedMcpServers`
5. `fleet profile <checkout> --apply` in each checkout whose profile gives the host Linear, once per harness
6. In each overlay whose tracker moves states on its own, name them under `## Tracker transitions`, for example: `Linear moves an issue to In Review when its pull request opens and to Done when it merges, linked by the branch name <team>-<n>-<slug>`
7. Drop `## Standing decisions` from each overlay: a decision a later change could undo is an ADR in the project's `docs/adr/`

## Commands

`fleet` drives pi and Claude containers alike, from a pi or a Claude Code host session, and `fleet --help` lists its verbs with every flag. The host session names itself in `FLEET_SEAT`, which each harness sets: Claude Code through the `env` of its managed settings, pi through the fleet monitor. `up`, `steer`, `watch`, `render` and `profile --apply` refuse without it; the verbs that only read or take a container down run anywhere. `up --pi|--claude` and `build --pi|--claude` pick the container's agent, the seat's own without a flag; every later verb reads it from the `agent` field of `sbx ls --json`. Every seat writes `up`, `steer` and `down` to one log, `~/.sandboxes/fleet-events.log`, so a watch sees a container whichever seat took it down. The lifecycle is `up`, `steer`, `watch`, `land`, `down`. `peek`, `ls`, `exec`, `artifacts` and `history` inspect a running or finished task, and `profile` prints what each seat may do in a repository. `init` seeds a new project with `AGENTS.md` and `spec/vision.md`, from `templates/project/`, and never overwrites a file that exists.

A pi host picks up a new render after `/reload`. A Claude host reads its rules at the next session. A container picks up a change only after `fleet build --pi|--claude`, and `up` warns when the image is older than the repository.

## What differs per harness

| Concern | pi | Claude Code | Why |
| --- | --- | --- | --- |
| Waking the host | `extensions/fleet-monitor.ts` runs `src/fleet/watch.ts` in process and triggers a turn per wake | `fleet watch` runs the same `watch.ts`, held with `Monitor` | Claude Code has no API for an extension to start a turn |
| Which containers wake it | the ones this session put up or steered, by `PI_SESSION_ID`; more with `/fleet-watch` | the ones this herdr pane put up or steered last; more by name on `fleet watch` | same as above |
| Agent state in herdr | `fleet relay` in the pane reports as `fleet:pi` | herdr reads Claude's screen | herdr's Claude integration reports only the session |
| Guard | extension, pi tool names translated | `PreToolUse` hook in root-owned managed settings, fails closed | where each agent lets code intercept a tool call |
| Session handoff | suggested in `status.md` at natural breaks; a `turn_end` note at 250k tokens and every 100k after; `/session-handoff` opens the fresh session | same suggestion; a `PostToolUse` hook at the same thresholds; `/clear` from the user or host, recorded by a `SessionStart` hook | Claude Code cannot replace a session from inside it |
| Error handoff | `agent_end` with `stopReason: error` | `StopFailure` hook | each agent's own error event |
| Status history into `logs/status.jsonl` | `tool_execution_end` | `PostToolUse`, `Stop` and `StopFailure` hooks | each agent's own after-tool event |
| Transcripts in `logs/sessions/` | written as they happen | copied out by `fleet down` | Claude Code has no session directory setting |
| Activity in `logs/activity.jsonl`, cost so far in wakes and `ls` | `tool_execution_end`; cost from `logs/sessions` | `PostToolUse` and `PostToolUseFailure` hooks; cost from `src/fleet/usage.ts` run in the container over its transcripts | Claude transcripts stay in the container until `fleet down` |
| Cost in `logs/usage.json` | the session's own cost records | computed from tokens with the price table in `src/fleet/usage.ts` | Claude transcripts carry tokens, not cost |
| Statusline | `extensions/statusline.ts` with `src/statusline/` | `claude/statusline.mjs` with `src/statusline/` | Claude Code runs a command |
| Models | seats in `pi/profiles/models.json` | seats in `claude/profiles/models.json`, `effort` per agent | `CLAUDE_CODE_SUBAGENT_MODEL` stays unset, see `inventory.md` |
| Phone control | `extensions/pi-remote` | Remote Control, a product setting | Claude Code ships its own |
| Host sandbox | none | macOS sandbox from root-owned managed settings | only Claude Code has one |

## Checks

```bash
npm test          # node --test over src/, the guard corpus, skills load, extension checks, the settings aligner
npm run check     # tsc --noEmit
```

## Trust model

Every signature comes from this Mac. Containers get no SSH agent and no signing key. Credentials reach them through the sbx proxy only, and they commit unsigned on the task branch. Who pushes, opens and merges pull requests is each repository's profile in `~/.config/harness/repos.json`, or the `*` of `host/repos.json` for a repository it omits, which agents read and never write: where it gives a container push `auto`, the container pushes its own branch with a token `up` refuses if it sees any other private repository; everywhere else pushes come from this Mac at the host's `push` level: the key behind Touch ID at `human`, HTTPS with the token the host session holds in `GH_TOKEN` at `auto` (`inventory.md`, GitHub tokens).

`land` fetches the branch through the `sandbox-<name>` remote that sbx registers in the host repo and refuses a branch that no longer descends from the one already here. It signs where the repository's profile gives the host `sign` (`--sign` forces it) and re-signs only the commits origin does not have, one Touch ID tap each, so the branch stays a fast-forward of what was pushed before. `--push` refuses anything that is not a fast-forward and runs on the user's word alone. Force, delete and mirror pushes and turning signing off stay the person's own commands, and the guard refuses them on every host. Merge stays with the person unless the profile gives the host merge `auto`; deploy and publishing stay with the person.

The guard matches patterns, not shell semantics: `eval` and variable indirection get past it. It stops mistakes and simple malicious code, not someone who has read the rule.

Every container runs with `CI=true`, so `vitest` or `jest` without a subcommand runs once and exits instead of watching. The price is that a repository behaves as in its pipeline: snapshots fail instead of updating, and some tools drop progress output.
