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
| `src/statusline/` | the status line pi and Claude draw: folder, branch, model, a context bar toward the 250k handoff, usage limits, in the terminal's own ANSI colours |
| `extensions/` | pi-family extensions (pi and OMP share the API): fleet monitor, guard, session handoff, error handoff, status history, the container's end of the state relay, pi's statusline, phone remote |
| `sbx/container/` | the container rule, `base-worktree` and the toolchain every image installs (`toolchain.Dockerfile`, rendered into each `<harness>/sbx/Dockerfile` at `{{toolchain}}`) |
| `host/` | the no-ssh-agent kit, the guard corpus and test runner, herdr's config and the blocker rules herdr reads on a pi screen |
| `pi/` | pi profiles, the model overrides pi and OMP both read (`models.json`), its Ayu Mirage theme, its host extension entry, kit, image |
| `omp/` | OMP profiles, its Ayu Mirage theme, its host extension entry, kit, image, installer, auth import |
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

`render` writes the host seat into the harness home; `build` renders the container seat into a stage and hands it to `sbx/build.sh`, which runs a harness's own `stage.sh` when the render carries one (Claude's plugins). A pi or OMP host reloads with `/reload`; a Claude host reads its rules at the next session.

## What stays different, and why

| Concern | pi | OMP | Claude Code | Why it cannot be shared |
| --- | --- | --- | --- | --- |
| Waking the host when a container settles | `extensions/fleet-monitor.ts` runs the shared `src/fleet/watch.ts` in process and turns each wake into a turn | the same extension, `deliverAs: nextTurn` | `cfleet watch` runs the same `watch.ts`, held with `Monitor` | Claude Code has no API for an extension to start a turn |
| Where herdr gets a container's working, blocked and done | herdr's own pi integration inside the container; `fleet relay` in the pane hands each report to herdr as `fleet:pi` | the same with herdr's OMP integration, `ofleet relay`, `fleet:omp` | herdr's screen rules for Claude | herdr's Claude integration reports only the session and herdr reads Claude's state from the screen |
| Which containers a session watches by itself | the one the session put up or steered, by `PI_SESSION_ID` the monitor puts on its `fleet` commands | the same, by `OMP_SESSION_ID` on its `ofleet` commands | whatever `cfleet watch` names | Claude Code has no API for an extension to start a turn |
| Guard | extension, pi tool names translated | extension, OMP tool names translated | `PreToolUse` hook in root-owned managed settings, fails closed | where each agent lets code intercept a tool call |
| Handoff at 250k context | a `turn_end` note tells the model once; `session_handoff` suggests in `status.md`; `/session-handoff` from the user or host opens the fresh session | the same | a `PostToolUse` hook tells the model once; a `Stop` hook suggests in `status.md` when no background task runs; `/clear` from the user or host, a `SessionStart` hook records it | Claude Code cannot replace a session from inside it |
| Error handoff | `agent_end` with `stopReason: error` | the same | `StopFailure` hook | each agent's own error event |
| Phone control | `extensions/pi-remote` over Tailscale Serve | not loaded | Remote Control, a product setting | OMP lacks `agent_settled` and `session_info_changed`; Claude ships its own |
| Status history | `tool_execution_end` copies each changed `status.md` into `logs/status/`, and so do the extensions' own writes | the same | `PostToolUse`, `Stop` and `StopFailure` hooks | each agent's own after-tool event, whichever tool wrote the file |
| Statusline | `extensions/statusline.ts` draws the footer with `src/statusline/` | native segments in `omp/profiles/settings.json`, coloured by `omp/themes/ayu-mirage.json` | `claude/statusline.mjs` draws with `src/statusline/` from the JSON Claude Code pipes in | OMP keeps `setFooter` a no-op and draws its own line; Claude Code runs a command |
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
