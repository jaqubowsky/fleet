# Test one rule at one decision point with fresh read-only runs

## Status

Accepted. Narrows 017 for rule wording: full-ticket runs stay for model choice, compaction and chained containers, and a rule's wording, a needless rule, a false instruction or a proof choice is tested as a micro-eval.

## Context

A full-ticket bench run costs hours and hundreds of requests, and a rule that matters at one decision point is diluted across the whole ticket. T3 Code's evals test one prompt at one decision point. A case must fail on the old text and pass on the new, and controls guard against overcorrection. Four facts from the host shaped how a run can be made here (2026-11-03).

- `claude --resume <id> --fork-session` follows the current CLAUDE.md, but the fork's transcript still holds the old rule as an `instructions` attachment, and the recorded system prompt is resent on resume. A forked replay shows the model both versions of the rule.
- `--bare` reads only `ANTHROPIC_API_KEY`, so it does not run on the subscription.
- `CLAUDE_CONFIG_DIR=<dir>` with a fresh dir is not logged in. A dedicated dir logged in once gives evals their own login, apart from the person's sessions and every container agent.
- Headless `claude` inside a container shared the agent's login and logged it out twice.

## Decision

A micro-eval is a fresh `claude -p` turn on the host. It is never a resumed or forked transcript. `fleet eval run --variant <harness root> --cases <id,...> [--reps n]` refuses a root with uncommitted changes and names the variant by its harness commit, as `fleet build --root` does. It renders that root's container seat into `~/.fleet/bench/evals/config`, replacing only `rules`, `refs`, `skills`, `agents` and `CLAUDE.md`, so the login there survives every render. The render points every `~/.claude/` path in that text at the config dir, so a rule's link to a ref or skill reads the variant's copy and not the person's host install. The container's `settings.json` is not copied, because its hooks point at paths inside the image; only its `effortLevel` and `autoMemoryEnabled` go into the config dir's `settings.json`, so the variant's thinking level runs too. The person's host guard lives in `~/.claude/settings.json`, so it does not load under the eval config dir.

A case lives outside the public repository, in `~/.fleet/bench/evals/cases/<id>/`:
- `case.json` names the source, which is the transcript and line of the original run or of the person's correction, and whether the case is a control.
- `prompt.md` puts the agent at the decision point.
- `fixture/` is the repository state, copied to a fresh scratch dir for every rep.
- `check.json` is a declarative list of expectations. Each one is a tool-name pattern with an optional input pattern, or a final-text pattern, and may be marked `absent`. Nothing in a case runs as code. Every case's check is validated before the render, so a stray key or a bad pattern costs no run.

The run allows only `Read`, `Grep`, `Glob` and `Skill`, with `--permission-mode default`. Every other call is denied, never hidden: `--tools` would hide the write tools so a write could never be attempted. A denied attempt stays in the stream transcript, where the check sees it. The main model and its thinking level are the variant's `sbx` seat, so a model variant is one `models.json` commit.

Results go to `~/.fleet/bench/evals/runs/<variant>/<case>/`: one stream-json transcript per rep, plus a `result.json` holding the pass count, the failed expectations, the denied calls, cost and tokens per rep, and sha256 hashes of the prompt, the check and the fixture tree. A rep whose `claude -p` fails, or whose stream ends in error or without a result, is recorded as an error and left out of the pass count, and the batch goes on. Running a case again under the same variant replaces its results. `fleet eval compare <baseline> <variant>` prints per-case pass counts side by side. It marks a case not comparable when its prompt, check or fixture hash differs between the two. It flags a non-control case invalid when the baseline passes it in half or more of its reps, since that baseline does not reproduce the original behaviour.

## Consequences

A rule variant is one commit on a branch. It ships only when its cases flip and its controls hold, so the shipped rules are never edited to run an eval. Nothing in this container has run a real `claude -p`: the flag names, the stream-json fields (`tool_use` blocks, `result`, `is_error`, `total_cost_usd`, `usage`, `permission_denials`), the exit status after a denial, whether `Read` reaches the config dir outside the scratch dir, whether a run started from inside a host agent session works, and whether `Skill` needs an allow entry were proven only on the fake IO, and the first host run is the check. A managed-settings file on the Mac would still load and could change permissions. The runner is claude only: the ticket fixes `claude -p` and a claude config-dir login, and the rules under test are text the two harnesses share.
