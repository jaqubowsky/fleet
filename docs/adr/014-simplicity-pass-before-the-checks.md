# Run a simplicity pass before the checks, and check added comments with a script

## Status

Accepted.

## Context

Containers kept adding comments and leaving dead or needlessly complex code although `rules/core.md` forbids comments and asks for the smallest code. On FLO-2093 and FLO-2094 the host had to order a comment sweep and a simplicity pass by hand, and the pass found a pass-through `handlers.ts`, one-caller functions, guards nothing showed failing, props no caller passed, and 59 pl and 47 en translation keys nothing read.

The comment rule binds when the agent reads it fresh. Micro-tests on 2026-10-29, claude-opus-5-5, 5 reps per arm, a rep failing when it adds a comment line:

| Scenario | No rules | `core.md` |
| --- | --- | --- |
| a flag beside JSDoc-commented flags, diff only | 5/5 fail | 0/5 |
| a hand-written SQL migration, diff only | 5/5 fail | 0/5 |
| the same two inside a flowMEE checkout with its 8300-word `CLAUDE.md` | 9/9 fail | 0/9 |

Production differs in how the code is written. The FLO-2093 container session made 1481 Bash calls and 7 Edit calls, and wrote `featureFlags.ts` and its comment through `cat >> … <<'EOF'`. The micro-tests asked for a diff and never reached that path, and no hook on Edit or Write would have seen it. Each container that swept comments built its own grep, with a different range and pattern each time.

The pass itself, on two branch diffs with 12 planted cases each, every arm ordered outright to simplify the diff:

| Arm | Easy diff | Harder diff |
| --- | --- | --- |
| no rules | 11/12 per rep; JSDoc kept in 3/5 | not run |
| `core.md` | 12/12 | 12/12 |
| `core.md` + skill with an eight-row pattern list | 12/12 | 12/12 |
| `core.md` + skill without the list | 12/12 | 12/12 |
| `core.md` + skill with the list as one sentence | 12/12 | 12/12 |

Asked outright, the agent finds the cases with or without a list. The order is what was missing. Whether the order fires on its own, each scenario listing the steps the container runs next, 5 reps per arm:

| Scenario | Seat before this change | Seat after |
| --- | --- | --- |
| first delivery, last slice committed | 0/5 name the pass | 5/5, before the branch update |
| a milestone steer, its code committed | 0/5 | 5/5, before the milestone's checks |

`two-axis-review` does not fill this gap by design: its reviewer reports a gap only when it affects correctness or a stated requirement, and a finding no test or trace reproduces stays unbuilt, so working code that is not needed stays.

## Decision

Skill `simplicity-pass` runs over the branch's whole diff once a round's last code is written, before the checks that close it: `sbx/container/sandbox.md` names it under `## Every round`, and `deliver-ticket` runs it after the last slice's commit and before the branch update. Its pattern list is one sentence, since the full list scored the same; it keeps two guards from the person's notes, a module entry file is a boundary and a duplicate counts only inside one module.

`added-comments origin/<base>` in `sbx/container/` is the comment check, copied into both images: it reads the diff, so it sees every write path. It prints each comment line the range adds as `added`, or `changed` where it rewords a base comment, and skips a comment that moved with its code. It must print nothing when the branch leaves the container, which also covers review fixes written after the pass.

## Consequences

The checks and the review run once, on the code the pass leaves. Every round that writes code pays for one read of the whole branch diff, so a later round mostly reports `none found`. A real container run has not yet confirmed the pass in production. The script ran its tests on BSD awk; the container's awk is first exercised by CI.
