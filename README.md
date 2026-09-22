# pi fleet

Pi on this Mac plus containers for code work. One container per task: a private clone in an sbx sandbox, pi waiting in a herdr tab, the person prompting it there. The host session puts containers up, watches them, and brings branches home. It prompts a container only when told to.

## Layout

| Path | What |
| --- | --- |
| `rules/` | global rules; `fleet render` folds them into `agent/AGENTS.md` and `sbx/AGENTS.md` |
| `agent/` | pi home: settings (generated), extensions, runtime state (ignored) |
| `src/guard/` | the tool-call policy and the pi-to-policy translation, driven by the case corpus in `host/tests/` |
| `agent/extensions/guard.ts` | the pi hook on this Mac: trusted tools out, everything else through `src/guard`. Containers run without it |
| `agent/extensions/fleet-monitor.ts` | watches every container `fleet up` and `fleet steer` touched (`agent/fleet-events.log`), plus `fleet_watch` for the rest: a container settling or working on without settling wakes the host with a `[fleet]` line carrying `status.md`, the commits on the branch and the review verdict |
| `agent/extensions/handoff-on-error.ts` | in the container: a pi run ending on an error sets `status.md` to `blocked` with the error as `attention` |
| `agent/extensions/statusline.ts` | status line |
| `profiles/` | `models.json` (one row per seat: `host`, `sbx`, `reviewer`, `explorer`, each a `<provider>/<model>` and a thinking level), `host.json` and `sbx.json` templates |
| `src/fleet/` | the `fleet` CLI, TypeScript, `node --test` |
| `sbx/` | worker image: `Dockerfile`, `build.sh`, and `container/sandbox.md`, which reaches the image through `fleet render` |
| `host/kits/` | sbx kits: pi (proxy credentials, LSP limits), no-ssh-agent |
| `host/inventory.md` | facts outside this repo: tokens, MCP servers, provider auth |
| `skills/` | `shared/` loads on both sides, `host/` only in this session, `container/` only in the image; `profiles/host.json` and `sbx/build.sh` read the directories |
| `~/.sandboxes/<repo>/` | mounted into every container on that repo as `$FLEET_ARTIFACTS`, kept after the container goes (outside this repo). `<sandbox>/` inside it is the task directory: `task.md` and `status.md` from `fleet up`, the files each skill owns, and `logs/` with pi's sessions (`PI_CODING_AGENT_SESSION_DIR`) and the `usage.json` that `fleet down` sums from them |
| `cache/<repo>/` | mounted into every container on that repo; what is expensive to rebuild (ignored) |
| `~/my-knowledge-base/` | mounted read-only into every container at the same absolute path; read by the `brain` skill |
| `audits/` | what skill `audit-harness` leaves: a ledger of audited transcripts and one report per run (ignored) |

## CI=true

Every container runs with `CI=true`, the convention the JavaScript ecosystem uses for "no person is watching this terminal". Test runners read it: `vitest` and `jest` invoked without a subcommand run once and exit instead of entering watch mode.

Without it a repository whose test script is bare `vitest` hangs forever, and a task that never exits is a task the build cache can never store, so the whole gate pays full price on every run. It also turns a silent hang into a result the worker can report.

The cost is that a repository behaves here as it does in its pipeline rather than on a developer machine: snapshots fail instead of updating themselves, and some tools drop their progress output.

## Commands

```text
fleet up <label> [--repo <path>] [--branch <name>] [--base <name>] [--model <provider/id:thinking>] [--memory 8g] [--cpus 4]
fleet ls
fleet peek <sandbox> [--lines 40]
fleet steer <sandbox> <text...>
fleet exec <sandbox> -- <command...>
fleet artifacts [--repo <path>]
fleet copy <src> <dst>
fleet land <sandbox> [--repo <path>] [--branch <name>] [--sign] [--push]
fleet down <sandbox> [--force]
fleet build
fleet render
```

## Checks

```bash
npm test          # fleet unit tests, guard policy cases, extension contract
npm run check     # tsc --noEmit
```

## Trust model

Containers get no SSH agent and no signing key. Credentials reach them through the sbx proxy only. They commit unsigned on the task branch. `fleet land` fetches the branch through the `sandbox-<name>` git remote that sbx registers in the host repo, and refuses one that no longer descends from the branch already here. `--sign` rewrites only the commits origin does not have yet, one Touch ID tap each, so the branch stays a fast-forward of what was pushed before. `--push` then pushes it and refuses anything that is not a fast-forward, on the user's word alone. Merge, deploy and publication stay with the person.

pi-lens keeps at most 2 LSP clients and evicts an idle tsserver after 30 s, which is what keeps a container from dying under a monorepo typecheck; installing a language server it needs is the container's own call, while managed tool installs (formatters, linters, scanners) stay off, because that fan-out is what pushed containers into OOM. The container sets no `--max-old-space-size`, because a repository that needs a heap budget declares it in the script that needs it, and a container-wide `NODE_OPTIONS` silently overrides every such script that defaults its own.
