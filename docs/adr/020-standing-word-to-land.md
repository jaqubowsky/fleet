# Let an overlay give the standing word to land

## Status

Accepted.

## Context

The host lands a container only on the person's word, every time. The repository profile already lets the host push, merge and close containers on its own (`push`, `merge` and `down` at `auto`), so in such a repository the land is the one step that still waits for a person. On 2026-11-09 the person handed `jaqubowsky/gimnasios` over whole: "to będzie wszystko autonomicznie tutaj się działo, full projekt e2e przez agenta". That repository works without pull requests, so every finished container would stop at the land.

## Decision

A project overlay, `~/.fleet/config/projects/<owner>/<repo>.md`, may hold a `## Host autonomy` section. When `fleet profile <repo>` prints one, the host holds the person's word to land standing, for every land the section covers, and lands without asking. Every other repository keeps the word each time. The section quotes the person's words with their date, so the grant can be traced to them.

The grant lives in the overlay, not in `repos.json`, because it is a sentence of judgement, which lands it covers and what still goes to the person, not a level a credential enforces. `repos.json` stays the person's alone, and the overlay is where the host already reads how a project works.

## Consequences

A repository with the section runs from ticket to `main` with no person in the loop, so a wrong land reaches `main` unseen. The host's acceptance on evidence (`orchestrating-agent-sessions`, `references/coordinating.md`) is the only check left. The guard (`src/guard/land.ts`) reads the section in the overlay of every repository of the sandbox and lets a bare land through without a dialog only when each overlay holds it; any other land, or a lookup that fails, still asks. Removing the section returns the repository to a word each time. The profile's land line still names a pull request; a no-PR repository's overlay `## Merge method` says how its work reaches `main`.
