# pi fleet

Pi on this Mac plus containers for code work. One container per task: a private clone in an sbx sandbox, pi waiting in a herdr tab, the person prompting it there. The host session puts containers up, watches them, and brings branches home. It prompts a container only when told to.

## Layout

| Path | What |
| --- | --- |
| `rules/` | global rules; `fleet provider` folds them into `agent/AGENTS.md` and `sbx/AGENTS.md` |
| `agent/` | pi home: settings (generated), extensions, runtime state (ignored) |
| `agent/extensions/guard.ts` + `host/hooks/guard.sh` | tool-call policy, tested by `host/tests/` |
| `agent/extensions/fleet-monitor.ts` | `fleet_watch` tool and `/fleet-watch`: every status change of another agent as a `[fleet]` line |
| `agent/extensions/statusline.ts` | status line |
| `profiles/` | `models.json` (providers x roles), `host.json` and `sbx.json` templates |
| `src/fleet/` | the `fleet` CLI, TypeScript, `node --test` |
| `sbx/` | worker image: `Dockerfile`, `build.sh`, `container/sandbox.md` |
| `host/kits/` | sbx kits: pi (proxy credentials, LSP and heap limits), no-ssh-agent |
| `host/inventory.md` | facts outside this repo: tokens, MCP servers, provider auth |
| `skills/` | skills for host and container; `sbx/build.sh` picks the container subset |

## Commands

```text
fleet up <label> [--repo <path>] [--branch <name>] [--memory 8g]
fleet ls
fleet peek <sandbox> [--lines 40]
fleet say <sandbox> <text...>
fleet exec <sandbox> -- <command...>
fleet copy <src> <dst>
fleet land <sandbox> [--repo <path>] [--branch <name>] [--sign]
fleet down <sandbox> [--force]
fleet provider [<name>]
```

## Checks

```bash
npm test          # fleet unit tests, guard policy cases, extension contract
npm run check     # tsc --noEmit
```

## Trust model

Containers get no SSH agent and no signing key. Credentials reach them through the sbx proxy only. They commit unsigned on the task branch. `fleet land` fetches the branch through the `sandbox-<name>` git remote that sbx registers in the host repo; `--sign` rewrites the commits with the host key, one Touch ID tap per commit. Push, merge, deploy and publication stay with the person.

Node in a container runs with `--max-old-space-size` derived from the sandbox memory, pi-lens keeps at most 2 LSP clients and evicts an idle tsserver after 30 s, and never installs language servers on its own. These three limits are what keeps a container from dying under a monorepo typecheck.
