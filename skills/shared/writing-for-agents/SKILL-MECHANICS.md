# Skill mechanics

The skill-specific branch of [`writing-for-agents`](SKILL.md): what changes when the document is a skill (the invocation choice, router skills, the frontmatter and directory format, bundled scripts). Everything else about writing it is the universal reference in `SKILL.md`.

## Invocation

Two choices, trading the two loads:

- A **model-invoked** skill keeps a `description`, so the agent can fire it autonomously, and other skills can reach it. You can still type its name: model-invocation always _includes_ user reach; a description only ever adds agent discovery, never removes the human's. The description is the skill's top-level context pointer, forced to stay loaded at all times: permanent context load in exchange for discoverability. A model-invoked skill whose content is all reference is also one home for shared reference: another skill can invoke it, so reference needed by several skills lives in one place. Mechanics: omit `disable-model-invocation`, and write a model-facing description carrying the trigger branches (the pointer-writing rules in `SKILL.md` apply in full).
- A **user-invoked** skill strips the description from the agent's reach: only the human typing its name can invoke it, and no other skill can. Zero context load, but it spends cognitive load: you are the index that must remember it exists. Mechanics: set `disable-model-invocation: true`; the `description` becomes human-facing: a one-line summary, trigger lists stripped.

Pick model-invocation only when the agent must reach the skill on its own, or another skill must. If it only ever fires by hand, make it user-invoked and pay no context load.

Shared reference that two user-invoked skills both need can live in neither: with no descriptions, neither can fire the other. Push it to a plain file outside the skill system: external reference any skill can point at.

## Testing a description

A model-invoked description is settled by running it, not by reasoning about it. Collect ~20 realistic prompts labelled should-trigger or should-not, run each three times, and read the trigger rate (above 0.5 passes). The negatives carry the weight: near-misses sharing the skill's vocabulary but needing something else prove the description is precise, where an unrelated prompt proves nothing. Hold ~40% of the prompts back as a validation set and tune only on the rest, or you buy phrasings you tested rather than wording that generalises.

The description cannot force what the agent would do anyway: a skill is consulted when the task exceeds what the agent would manage unaided, so a one-step request it already handles will not trigger one however well the wording matches.

## Splitting by invocation

The invocation cut of splitting (the sequence cut lives in `SKILL.md`): split off a model-invoked skill when you have a distinct leading word that should trigger it on its own (a trigger word you actually use in your prompts), or another skill must reach it. You pay context load for the new always-loaded description, so that independent reach has to be worth it.

## Router skills

When user-invoked skills multiply past what you can remember, that piled-up cognitive load is cured by a **router skill**: one user-invoked skill that names the others and when to reach for each, so the human has one skill to remember instead of many. It can only hint, never fire them: user-invoked skills have no description, so nothing but the human can reach them.

## Format

A skill is a directory whose `SKILL.md` carries YAML frontmatter and a free-form Markdown body.

| Field | | Constraint |
| --- | --- | --- |
| `name` | required | 1-64 chars, lowercase `a-z0-9` and single hyphens, no leading or trailing hyphen, matches the directory name |
| `description` | required | 1-1024 chars; it grows under editing, so check the count after every pass |
| `license` | optional | a licence name, or the bundled file that holds the terms |
| `compatibility` | optional | <=500 chars, and only when the skill needs something the environment may lack: a product, a system package, network access |
| `metadata` | optional | string-to-string map for whatever the spec does not define |
| `allowed-tools` | optional | space-separated pre-approved tools, e.g. `Bash(git:*) Read`; experimental, support varies |

Budgets follow the ladder in `SKILL.md`: name and description sit in context always (~100 tokens), the body loads whole on activation (keep it under 500 lines and 5k tokens), everything else waits behind a pointer. The conventional homes are `scripts/` for executables, `references/` for on-demand docs, `assets/` for templates and data. Point at them by relative path from the skill root, one level deep: a chain the agent has to walk twice mostly goes unwalked. `skills-ref validate ./<skill>` checks the frontmatter and the naming.

## Scripts

A command the agent would have to get right first try belongs in `scripts/` as a tested file; a couple of flags around an existing tool belongs inline. The signal for extracting one: across runs the agent keeps rebuilding the same logic.

Name the bundled scripts in the body so the agent knows they exist, call them through their interpreter (`bash scripts/check.sh`) since a packager that strips the executable bit turns a bare path into `Permission denied`, pin versions on anything fetched at run time (`npx eslint@9`, `uvx ruff@0.8.0`) so the command means the same thing next month, and state a runtime prerequisite in `compatibility` rather than assuming the machine has it.
