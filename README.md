# harness

One source for three agent harnesses on this Mac: pi, OMP and Claude Code. Each runs a host session plus containers for code work: one container per task, a private clone in an sbx sandbox, the agent waiting in a herdr tab, the person prompting it there. The host session puts containers up, watches them, and brings branches home. It prompts a container only when told to.

Rules, skills, sub-agents, the guard policy, the fleet CLI and the container scaffolding are written once. `pi/`, `omp/` and `claude/` hold only what one harness cannot share: its settings, its extension or hook wiring, its image and kit, and the fragments of text that name its own tools.

## Layout

| Path | What |
| --- | --- |
| `rules/` | global rules; `{{token}}` marks the words that differ per harness |
| `rules/refs/` | references the rules point to: the task directory contract, testing |
| `skills/` | `shared/` loads on both seats, `host/` only on the host, `container/` only in the image |
| `agents/` | the read-only sub-agents `explorer`, `researcher`, `reviewer`; each harness supplies their frontmatter as `fragments/agent-<name>.md` |
| `fragments/` | text a harness can replace with its own `<harness>/fragments/<name>.md` |
| `src/harness.ts` | every value that differs per harness: CLI name, sandbox prefix, agent, image, kit, launch flags, the render tokens |
| `src/render/` | renders rules, skills, agents and settings for a harness seat |
| `src/fleet/` | the fleet CLI behind `fleet`, `ofleet` and `cfleet`; `node --test` |
| `src/guard/` | the tool-call policy all three hosts enforce, driven by the case corpus in `host/tests/` |
| `extensions/` | pi-family extensions (pi and OMP share the API): fleet monitor, guard, session handoff, error handoff, pi's statusline, phone remote |
| `sbx/container/` | the container rule and `base-worktree`, the same in every image |
| `host/` | the no-ssh-agent kit, the guard corpus and test runner, herdr's config |
| `pi/` | pi profiles and models, its host extension entry, kit, image |
| `omp/` | OMP profiles, its host extension entry, statusline, herdr state reporter, kit, image, installer, auth import |
| `claude/` | Claude Code's guard hook, container hooks, statusline, managed settings, settings aligner, image |
| `bin/` | `fleet`, `ofleet`, `cfleet`: the one CLI with its harness set |
| `sync.sh` | brings every harness home, link, image and setting in line with this repository and removes what nothing uses; prints the plan, `--apply` makes it |
| `inventory.md` | facts outside this repo: tokens, MCP servers, model logins, network policy |
| `BOOTSTRAP.md` | setting this Mac up from nothing |

The harness homes hold only rendered files and runtime state: `~/.pi` (`agent/settings.json`, `agent/AGENTS.md`, `agent/refs/`, `agent/agents/`, `skills/`), `~/.omp` (the same with `agent/config.yml`), `~/.claude` (`rules/`, `skills/`, `agents/`, `CLAUDE.md`). Edit here and run `./sync.sh --apply`; never edit a home. Render replaces `skills/`, `rules/`, `agents/` and `agent/refs/` whole, so a file removed here is gone there too.

## Commands

The same verbs on every harness; `fleet` drives pi containers, `ofleet` OMP ones, `cfleet` Claude ones.

```text
<cli> up <label> [--repo <path>] [--branch <name>] [--base <name>] [--model <id>] [--memory 8g] [--cpus 4]
<cli> ls
<cli> peek <sandbox> [--lines 40]
<cli> steer <sandbox> <text...>
<cli> exec <sandbox> -- <command...>
<cli> artifacts [--repo <path>]
<cli> copy <src> <dst>
<cli> land <sandbox> [--repo <path>] [--branch <name>] [--sign] [--push]
<cli> down <sandbox> [--force]
<cli> build
<cli> render [--seat host|container] [--out <dir>]
<cli> watch [<sandbox>...]
```

`render` writes the host seat into the harness home; `build` renders the container seat into a stage and hands it to `<harness>/sbx/build.sh`. A pi or OMP host reloads with `/reload`; a Claude host reads its rules at the next session.

## What stays different, and why

| Concern | pi | OMP | Claude Code | Why it cannot be shared |
| --- | --- | --- | --- | --- |
| Waking the host when a container settles | `extensions/fleet-monitor.ts` starts a turn | the same extension, `deliverAs: nextTurn` | `cfleet watch` held with `Monitor` | Claude Code has no API for an extension to start a turn |
| Which containers a session watches by itself | the one the session put up, by `PI_SESSION_ID` | the one the session put up, by `OMP_SESSION_ID` exported by the monitor | whatever `cfleet watch` names | Claude Code has no API for an extension to start a turn |
| Guard | extension, pi tool names translated | extension, OMP tool names translated | `PreToolUse` hook in root-owned managed settings, fails closed | where each agent lets code intercept a tool call |
| Handoff at 250k context | `session_handoff` tool opens a fresh session | the same | a `Stop` hook raises attention; the host sends `/clear` | Claude Code cannot replace a session from inside it |
| Error handoff | `agent_end` with `stopReason: error` | the same | `StopFailure` hook | each agent's own error event |
| Phone control | `extensions/pi-remote` over Tailscale Serve | not loaded | Remote Control, a product setting | OMP lacks `agent_settled` and `session_info_changed`; Claude ships its own |
| Statusline | `extensions/statusline.ts` | `omp/extensions/statusline.ts` on OMP's footer keys | `claude/statusline.mjs` | three different status APIs |
| Models | seats in `pi/profiles/models.json` | seats in `omp/profiles/models.json` | seats in `claude/profiles/models.json`, `--model` per container | all three read model seats; Claude also takes `effort` per agent, and `CLAUDE_CODE_SUBAGENT_MODEL` stays unset so a sub-agent keeps its own (anthropics/claude-code#10993) |
| Transcripts | written into the task directory as they happen | the same | copied out of the container by `cfleet down` | Claude Code has no session directory setting |
| Cost in `usage.json` | from the session's own cost records | the same | tokens only | Claude transcripts carry no cost |
| Host sandbox | none | none | macOS sandbox from root-owned managed settings | only Claude Code has one |

## Checks

```bash
npm test          # fleet, render and guard units, skills load, extension contract, Claude hooks, settings aligner
npm run check     # tsc --noEmit over src, extensions and every harness part
```

## Trust model

Every signature and every push comes from this Mac, from the key behind Touch ID. Containers get no SSH agent and no signing key; credentials reach them through the sbx proxy only, and they commit unsigned on the task branch. `land` fetches the branch through the `sandbox-<name>` git remote that sbx registers in the host repo and refuses one that no longer descends from the branch already here. `--sign` rewrites only the commits origin does not have yet, one Touch ID tap each, so the branch stays a fast-forward of what was pushed before. `--push` then pushes it and refuses anything that is not a fast-forward, on the user's word alone. A force, delete or mirror push, and turning signing off, stay the person's own command: the guard refuses them on every host. Merge, deploy and publication stay with the person.

The guard matches patterns, not shell semantics: `eval` and variable indirection get past it. It is a barrier against mistakes and simple malicious code, not against someone reading the rule.

## CI=true

Every container runs with `CI=true`, the convention the JavaScript ecosystem uses for "no person is watching this terminal". Test runners read it: `vitest` and `jest` invoked without a subcommand run once and exit instead of entering watch mode. The cost is that a repository behaves here as it does in its pipeline: snapshots fail instead of updating themselves, and some tools drop their progress output.
