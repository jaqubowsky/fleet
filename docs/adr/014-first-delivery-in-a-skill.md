# Keep a first delivery in a skill and every round's rules in the sandbox rules

## Status

Accepted.

## Context

A container's always-loaded rules carried the whole first delivery: the analysis, the slices, the checks table, the branch update and the final checks. Later rounds, such as a pull request review round, need none of that, yet loaded it every turn. A micro-test on 2026-10-28 (`dt-stub-v2`, `dt-later`, 5 reps per arm on claude) scored the moved procedure as well as the always-loaded text once the ticket's first line named the skill, and the later round as well with the procedure gone.

## Decision

Skill `deliver-ticket` holds the first delivery, from the analysis to the final checks, with the conflict rules of a branch update. `fleet up` writes `ticket.md` with a first line that loads it, and the host writes the ticket below that line. `sbx/container/sandbox.md` keeps every rule a later round needs, under `## Every round`, and names `deliver-ticket` under `## Delivery`. `src/render/layers.ts` lets `deliver-ticket` name skills and mechanics as `sandbox.md` does.

## Consequences

A container rule that a later round needs belongs in `sandbox.md`, even when `deliver-ticket` would read as its home. A delivery whose ticket lost its first line runs on `## Delivery` alone. A full container run on a real ticket has not yet confirmed the move.
