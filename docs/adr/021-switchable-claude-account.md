# Switch the Claude account of every container at once

## Status

Accepted, pending the first live check: `/status` in a fresh sandbox after `fleet account use` names the chosen account.

## Context

The person holds two Claude subscriptions, work and private, and wants to switch which one the agents bill while they run (2026-11-12: "ja bym chciał to móc zmieniać na żywo"). Containers reached Anthropic through one global sbx `anthropic` login, made by `/login` in the first container, so a second account meant logging out and in again.

## Decision

Each account's long-lived token from `claude setup-token` sits in the macOS keychain under service `fleet-claude`. `fleet account use <name>` copies the chosen token into one item, `fleet-claude-active`, and keeps one global sbx custom secret pointed at it: the host `api.anthropic.com`, the variable `CLAUDE_CODE_OAUTH_TOKEN` set to a fixed placeholder, and a `--command` that reads that item with a refresh of one minute. The proxy swaps the placeholder for the token on the way out, so the token never enters a container, and a switch reaches running containers within a minute.

The switch is global, not per sandbox, because the person switches the account they work under, not the account of one task. The placeholder is fixed, so updating the secret on each `use` leaves the variable in every existing sandbox valid.

The host stays on its own `/login`, which the docs say switches the running session. A session on a token instead loses Remote Control and claude.ai connectors (code.claude.com/docs/en/authentication), which the host uses.

## Consequences

A sandbox made before the first `use` lacks the variable and needs a new `up`. The global `anthropic` login stays in place; `CLAUDE_CODE_OAUTH_TOKEN` takes precedence over it inside the container, and whether the proxy's `anthropic` service rewrites the same header after the custom secret is the open question the live check answers. A token expires after a year and `fleet account set` stores its replacement. pi seats use openai and openrouter, so pi is untouched.
