# harness

One source for three agent harnesses on this Mac: pi, OMP and Claude Code. Each one runs a host session plus one container per task. A container is a private clone in an sbx sandbox with the agent waiting in a herdr tab. The host session puts containers up, watches them and brings their branches home. It prompts a container only when told to.

Rules, skills, sub-agents, the guard policy, the fleet CLI and the container setup are written once. `pi/`, `omp/` and `claude/` hold only what one harness cannot share: its settings, its extension or hook wiring, its image and kit, and the text fragments that name its own tools.

## Architecture

The repository renders into two seats per harness. The host seat is the harness home on this Mac. The container seat is the image every task container starts from.

```text
                   ~/harness, the only place to edit
 ┌──────────────────────────────────────────────────────────────────┐
 │ written once                        per harness                  │
 │   rules/  rules/refs/  agents/        pi/  omp/  claude/         │
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
   ./sync.sh --apply, <cli> render      <cli> build, then sbx/build.sh
   ~/.pi  ~/.omp  ~/.claude             my-pi:v1  my-omp:v1  my-claude:v1
   rules/ with host.md                  rules/ without host.md, + sandbox.md
   skills/shared + skills/host          skills/shared + skills/container
```

At runtime the host and a container share one task directory and talk through herdr and git. The container's code reaches the host only through `land`, and its reports only through the task directory.

```text
            this Mac                                   sbx sandbox, one per task
 ┌────────────────────────────────┐              ┌────────────────────────────────┐
 │ host session                   │  up, steer   │ agent in a herdr tab           │
 │ pi, omp or claude              │ ───────────▶ │ private clone, task branch     │
 │                                │              │ no SSH agent, no signing key   │
 │ <cli> watch                    │ herdr state  │                                │
 │   herdr socket + status.md     │ ◀─────────── │ working, blocked, done         │
 │   = one [fleet] line per wake  │              │                                │
 │                                │  git remote  │                                │
 │ <cli> land --sign --push       │ ◀─────────── │ unsigned commits               │
 │   Touch ID signs, pushes ff    │ sandbox-<n>  │                                │
 └───────────────┬────────────────┘              └───────────────┬────────────────┘
                 │                                               │
                 │     ~/.sandboxes/<repo>/<sandbox>/            │
                 └───▶ task directory, $FLEET_ARTIFACTS  ◀───────┘
                       status.md  analysis.md  review.md  logs/
```

A task moves through the pipeline in `rules/refs/artifacts.md`, and `status.md` carries its state. The host wakes each time the container's agent settles, and again when it works long without settling.

```text
 up ─▶ steer ─▶ analyze-task ─▶ to-tickets ─▶ per ticket: implement + tdd,
 new            analyzing                     two-axis-review, one commit
                                              implementing, reviewing
                                                          │
 down ◀── land ◀── ready-for-host ◀── check-feature ◀─────┘
 logs/usage.json,  --sign, --push     testing
 task dir stays

 blocked at any step: attention: names what the person has to decide
```

## Layout

| Path | What |
| --- | --- |
| `rules/` | global rules; `{{token}}` marks the words that differ per harness |
| `rules/refs/` | what the rules point to: the task directory contract, testing |
| `skills/` | `shared/` renders into both seats, `host/` into the host seat, `container/` into the image |
| `agents/` | read-only sub-agents `explorer`, `researcher`, `reviewer`; each harness adds their frontmatter as `fragments/agent-<name>.md` |
| `fragments/` | text a harness can replace with its own `<harness>/fragments/<name>.md` |
| `src/harness.ts` | every value that differs per harness |
| `src/render/` | renders rules, skills, agents and settings for one harness and seat |
| `src/fleet/` | the fleet CLI behind `fleet`, `ofleet` and `cfleet` |
| `src/guard/` | the tool-call policy all three hosts enforce, tested against the case corpus in `host/tests/` |
| `src/remote/` | the pi phone remote, see `extensions/pi-remote/README.md` |
| `src/statusline/` | the status line pi and Claude draw: folder, branch, model, context bar toward the 250k handoff, usage limits |
| `extensions/` | pi-family extensions (pi and OMP share the API): fleet monitor, guard, session handoff, error handoff, status history, state relay, statusline, phone remote |
| `sbx/` | `build.sh`, the container rule `sandbox.md`, `base-worktree` and `toolchain.Dockerfile`, which every `<harness>/sbx/Dockerfile` pulls in at `{{toolchain}}` |
| `host/` | herdr config and pi screen rules, the no-ssh-agent kit, the guard corpus and test runner |
| `pi/`, `omp/`, `claude/` | per-harness profiles, model seats, themes, host extension entry or hooks, kit, image |
| `bin/` | `fleet`, `ofleet`, `cfleet`: one CLI, one harness each |
| `sync.sh` | brings every home, link, image and setting in line with this repository; prints the plan, `--apply` makes it |
| `inventory.md` | what lives outside this repo: tokens, MCP servers, model logins, network policy |
| `BOOTSTRAP.md` | setting this Mac up from nothing |

The homes hold only rendered files and runtime state. Edit here and run `./sync.sh --apply`, never edit a home. Render replaces the directories listed in `OWNED` in `src/render/render.ts` whole, so a file removed here disappears there too.

## Commands

`fleet` drives pi containers, `ofleet` OMP ones, `cfleet` Claude ones. The verbs are the same on all three and `<cli> --help` lists them with every flag. The lifecycle is `up`, `steer`, `watch`, `land`, `down`. `peek`, `ls`, `exec`, `artifacts` and `history` inspect a running or finished task, and `profile` prints what each seat may do in a repository.

A pi or OMP host picks up a new render after `/reload`. A Claude host reads its rules at the next session. A container picks up a change only after `<cli> build`, and `up` warns when the image is older than the repository.

## What differs per harness

| Concern | pi | OMP | Claude Code | Why |
| --- | --- | --- | --- | --- |
| Waking the host | `extensions/fleet-monitor.ts` runs `src/fleet/watch.ts` in process and triggers a turn per wake | same extension, `deliverAs: nextTurn` | `cfleet watch` runs the same `watch.ts`, held with `Monitor` | Claude Code has no API for an extension to start a turn |
| Which containers wake it | the ones this session put up or steered, by `PI_SESSION_ID`; more with `/fleet-watch` | same, by `OMP_SESSION_ID` | every container, or the ones `cfleet watch` names | same as above |
| Agent state in herdr | `fleet relay` in the pane reports as `fleet:pi` | `ofleet relay`, `fleet:omp` | herdr reads Claude's screen | herdr's Claude integration reports only the session |
| Guard | extension, pi tool names translated | extension, OMP tool names translated | `PreToolUse` hook in root-owned managed settings, fails closed | where each agent lets code intercept a tool call |
| Session handoff | suggested in `status.md` at natural breaks; a `turn_end` note at 250k tokens and every 100k after; `/session-handoff` opens the fresh session | same | same suggestion; a `PostToolUse` hook at the same thresholds; `/clear` from the user or host, recorded by a `SessionStart` hook | Claude Code cannot replace a session from inside it |
| Error handoff | `agent_end` with `stopReason: error` | same | `StopFailure` hook | each agent's own error event |
| Status history into `logs/status/` | `tool_execution_end` | same | `PostToolUse`, `Stop` and `StopFailure` hooks | each agent's own after-tool event |
| Transcripts in `logs/sessions/` | written as they happen | same | copied out by `cfleet down` | Claude Code has no session directory setting |
| Cost in `logs/usage.json` | the session's own cost records | same | computed from tokens with the price table in `src/fleet/usage.ts` | Claude transcripts carry tokens, not cost |
| Statusline | `extensions/statusline.ts` with `src/statusline/` | native segments in `omp/profiles/settings.json` | `claude/statusline.mjs` with `src/statusline/` | OMP draws its own footer; Claude Code runs a command |
| Models | seats in `pi/profiles/models.json` | seats in `omp/profiles/models.json` | seats in `claude/profiles/models.json`, `effort` per agent | `CLAUDE_CODE_SUBAGENT_MODEL` stays unset, see `inventory.md` |
| Phone control | `extensions/pi-remote` | not loaded | Remote Control, a product setting | OMP lacks `agent_settled` and `session_info_changed` |
| Host sandbox | none | none | macOS sandbox from root-owned managed settings | only Claude Code has one |

## Checks

```bash
npm test          # node --test over src/, the guard corpus, skills load, extension checks, the settings aligner
npm run check     # tsc --noEmit
```

## Trust model

Every signature comes from this Mac. Containers get no SSH agent and no signing key. Credentials reach them through the sbx proxy only, and they commit unsigned on the task branch. Who pushes, opens and merges pull requests is each repository's profile in `host/repos.json`, which agents read and never write: where it gives a container push `auto`, the container pushes its own branch with a token `up` refuses if it sees any other private repository; everywhere else pushes come from this Mac at the host's `push` level: the key behind Touch ID at `human`, HTTPS with the token the host session holds in `GH_TOKEN` at `auto` (`inventory.md`, GitHub tokens).

`land` fetches the branch through the `sandbox-<name>` remote that sbx registers in the host repo and refuses a branch that no longer descends from the one already here. It signs where the repository's profile gives the host `sign` (`--sign` forces it) and re-signs only the commits origin does not have, one Touch ID tap each, so the branch stays a fast-forward of what was pushed before. `--push` refuses anything that is not a fast-forward and runs on the user's word alone. Force, delete and mirror pushes and turning signing off stay the person's own commands, and the guard refuses them on every host. Merge stays with the person unless the profile gives the host merge `auto`; deploy and publishing stay with the person.

The guard matches patterns, not shell semantics: `eval` and variable indirection get past it. It stops mistakes and simple malicious code, not someone who has read the rule.

Every container runs with `CI=true`, so `vitest` or `jest` without a subcommand runs once and exits instead of watching. The price is that a repository behaves as in its pipeline: snapshots fail instead of updating, and some tools drop progress output.
