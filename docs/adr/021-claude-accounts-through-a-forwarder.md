# Claude containers reach Anthropic through a forwarder on the Mac

## Status

Accepted.

## Context

The person holds two Claude subscriptions, work and private, and wants to switch the account the containers bill while they run (2026-11-12: "ja bym chciał to móc zmieniać na żywo"), and to let one host session keep its containers on one account while another uses the other.

sbx 0.48 holds one Anthropic login for the whole Mac, made by `/login` inside a sandbox. Probes on 2026-11-12 showed its proxy decides the auth of every request to `api.anthropic.com`:

- with that login stored, it put the login on every request, even one with a junk bearer or none (200, autoMEE)
- with no login stored, it stripped `Authorization` ("Missing Authorization header"), so a `sbx secret set-custom` placeholder for that host never arrived
- a sandbox-scoped `anthropic` secret is injected as `x-api-key`, where a subscription token gets 401 "invalid x-api-key"

The same day a request from a sandbox to `http://host.docker.internal:18080` reached a forwarder on the Mac untouched. With a `claude setup-token` token as bearer and the `oauth-2025-04-20` beta, Anthropic answered with the organization id of the account the forwarder chose (`f0f2e44f…` work, `0f628088…` private) and subscription limit headers (`anthropic-ratelimit-unified-5h-*`, `-7d-*`), not API billing.

## Decision

sbx holds no Anthropic login. `fleet account serve`, run by launchd as `fleet.claude-forwarder`, listens on `127.0.0.1:18080` and forwards to `https://api.anthropic.com`. `fleet up` gives each Claude sandbox `ANTHROPIC_BASE_URL=http://host.docker.internal:18080` and `ANTHROPIC_AUTH_TOKEN=<random key>`. `~/.fleet/claude-accounts.json`, mode 0600 and outside every sandbox mount, maps each key to its sandbox and the sandbox to an account, or to the default. The forwarder replaces the key with that account's token from the keychain (service `fleet-claude`) on every request, adds the OAuth beta, and refuses an unknown key with 401 without calling Anthropic.

A key per sandbox, not one shared placeholder, is what lets one sandbox bill another account than the rest, and it keeps any other process on the Mac, or a web page, from spending a subscription through the forwarder. `FLEET_CLAUDE_ACCOUNT` in the host session pins the account of every container it brings up.

The guard refuses `fleet account set` and `fleet account use` to agents: switching to the other account when one hits its limit is the use Anthropic's terms flag.

## Consequences

If the forwarder stops, every Claude container fails its next request until launchd restarts it. A `/login` inside a sandbox would make sbx store a login again and override the forwarder on `api.anthropic.com`. A sandbox made before this change has no key and needs a new `up`. Claude Code reports claude.ai connectors as disabled in the containers. The host sessions keep their own `/login`; `FLEET_CLAUDE_ACCOUNT` steers only the containers. A token expires after a year and `fleet account set` stores its replacement. pi seats use openai and openrouter, so pi is untouched.
