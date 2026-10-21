# Load the prose catalogue on the host

## Status

Accepted. Narrows `dfdcce5`, which put the catalogue behind a pointer on both seats, to the container.

## Context

Since `dfdcce5` the core rules reach `refs/prose.md` through a pointer: a reply or file past a few paragraphs, or a message to a person, reads it first. The audit of 2026-10-20 counted the reads over two days: the flowMEE host session, with 634 tool calls, opened it zero times, and one of twelve containers opened it. In that session 5 of the person's 110 turns asked what a reply meant, after replies that carried code names, hashes and test labels.

## Decision

For pi and Claude alike, the host seat loads `rules/refs/prose.md` as one of its rules: Claude gets `rules/prose.md`, pi gets it folded into `AGENTS.md`. A container keeps the pointer and the ref. `src/render/render.ts` lists the refs the host loads in `HOST_LOADED_REFS`. The core rules also say that an id, hash, test label or name from the code reaches a person beside a plain description, so the most frequent miss holds without the catalogue.

## Consequences

Every host session carries about 1300 more words of rules. A container's context stays as it was, so its closing messages still depend on the pointer. Whether loading the catalogue lowers the share of turns asking what a reply meant is measured by the next audit against 5 in 110.
