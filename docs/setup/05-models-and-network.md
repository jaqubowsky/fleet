# 5. Model logins and network for sandboxes

## pi sandboxes

pi sandboxes never log in. sbx stores the login on this Mac and its proxy swaps a placeholder for it on the way out. Bind the providers the pi seats use after step 1:

```bash
sbx secret set openai --oauth        # openai-codex seats; person completes the browser login
sbx secret set openrouter            # openrouter seats; person pastes the key
mkdir -p ~/.config/sbx
printf 'bindings:\n  openai:\n    oauth:\n      domains:\n        - auth.openai.com\n        - chatgpt.com\n' > ~/.config/sbx/credentials.yaml
```

Without `~/.config/sbx/credentials.yaml` every model call from a pi sandbox is a 401, and `fleet up` refuses to start one.

## Claude sandboxes

Claude sandboxes never log in, and sbx holds no Anthropic login. Each one sends its requests to a forwarder on this Mac, `fleet account serve` on `127.0.0.1:18080`, which `./sync.sh --apply` installs as the launchd agent `fleet.claude-forwarder` and keeps running. `fleet up` gives each sandbox a random key of its own; the forwarder swaps that key for the token of the account the sandbox bills and refuses any other key. The token stays on this Mac.

The person stores each account once, in their own terminal, and picks the default:

```bash
claude setup-token              # log in to the account in the browser; prints a token valid for a year
fleet account set work          # paste it; echo is off
fleet account use work          # the account every container bills unless it has one of its own
sbx policy allow network localhost:18080
```

`fleet account use <name>` switches every container without an account of its own from its next request, with no restart. `fleet account use <name> <sandbox>...` moves only those sandboxes. A host session started with `FLEET_CLAUDE_ACCOUNT=<name>` gives every container it brings up that account, which a later default switch leaves alone. `fleet account` lists the default and each sandbox's account. A sandbox made before the forwarder has no key and needs a new `fleet up`. The guard refuses `set` to agents and lets `use` through.

Never run `/login` inside a Claude sandbox: sbx would store that login and put it on every request to `api.anthropic.com`. `sbx secret ls` must list no `anthropic` row.

## Network

sbx keeps one allowlist for every sandbox on this Mac, and the pi sandbox adds its own model and package hosts (`pi/kits/pi/spec.yaml`). `sbx policy inspect local-policy` prints the list, and `sbx policy allow network <host>` adds a host.

The sandboxes need `github.com`, `api.github.com` and the API hosts of the model providers from step 1. Add any of those the list lacks. pi's `web_search` also needs `mcp.exa.ai`; without it only that tool fails. Which hosts sandboxes may reach is the person's call: name each one before adding it.

## Gotchas

- `sbx <command> --help` is the authority on its flags. A wrong flag binds a secret to the wrong scope without an error
- `CLAUDE_CODE_SUBAGENT_MODEL` must stay unset: it can override the model each rendered agent names (anthropics/claude-code#10993)

## Check

`test -f ~/.config/sbx/credentials.yaml && echo ok` prints `ok`, `fleet account` names a default, `launchctl print gui/$(id -u)/fleet.claude-forwarder` shows `state = running`, `sbx secret ls` lists no `anthropic` row, `echo "${CLAUDE_CODE_SUBAGENT_MODEL:-unset}"` prints `unset`, and `sbx policy inspect local-policy` lists every host the person approved.
