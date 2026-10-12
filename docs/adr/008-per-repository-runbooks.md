# Keep every repository's runbook in its own task root

## Status

Accepted. Replaces the group roots that `88271e6` introduced for multi-repository tasks.

## Context

Since `88271e6`, a multi-repository task lived under `~/.fleet/tasks/groups/<repo-names>-<hash>/` with a runbook of its own. That commit recorded only that "a new multi-repository task has its own group root, not the first repo's runbook". In FLO-1895 the cost showed:

- Knowledge about flowMEE alone was already in `~/.fleet/tasks/flowMEE/runbook`, but the container could not read it. That knowledge was the web typecheck OOM, the `openapi.json` drift and the `API_DOMAIN_ADDRESS` pin.
- The run spent about 24 minutes rediscovering it.
- The group runbook then filled with flowMEE facts and the processor's base results, and the host copied them back by hand.

Every tool surveyed keeps operational knowledge per repository: AGENTS.md, Claude Code, OpenHands, Copilot, Codespaces and Devin.

## Decision

For pi and Claude alike, a task lives under its primary repository's root, `~/.fleet/tasks/<primary>/<sandbox>/`, whether it spans one repository or several, and `$FLEET_ARTIFACTS/runbook` is the primary's runbook.

`fleet up` creates each other repository's `~/.fleet/tasks/<repo>/runbook` and mounts it read-write at the same absolute path. It skips one whose path equals the primary's.

The container rules name where each runbook is, and they say to read each one's `gotchas.md` before the first gate and its `run.sh` before the first app start. A fact about one repository goes into that repository's runbook. Wiring between repositories (a callback address, ports, start order) goes into the runbook of the repository that calls the other.

No set-level runbook exists. The check that every `--repo` has a distinct GitHub origin moves to where `up` plans the repositories.

## Consequences

What one task learns about a repository reaches every later task on that repository, single or multi-repository, with no copying by the host.

A multi-repository container can write into another repository's runbook, so a wrong fact spreads as far as a right one. The person reads those runbooks.

Tasks already recorded under `groups/` keep their path through `repositories.json`, and the host moves them. No code produces a `groups/` path any more, and `fleet artifacts` still lists the old roots.
