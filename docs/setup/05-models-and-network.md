# 5. Model logins and network for sandboxes

## pi sandboxes

pi sandboxes never log in. sbx stores the login on this Mac and its proxy swaps a placeholder for it on the way out:

```bash
sbx secret set openai --oauth        # person: completes the browser login
sbx secret set openrouter            # only when a seat uses openrouter; person pastes the key
mkdir -p ~/.config/sbx
printf 'bindings:\n  openai:\n    oauth:\n      domains:\n        - auth.openai.com\n        - chatgpt.com\n' > ~/.config/sbx/credentials.yaml
```

Without `~/.config/sbx/credentials.yaml` every model call from a pi sandbox is a 401, and `fleet up` refuses to start one.

## Claude sandboxes

The first `fleet up --claude` stops and asks the person to run `/login` once in its tab. sbx keeps that login for every later sandbox.

## Network

sbx keeps one network allowlist for every sandbox on this Mac. `sbx policy inspect local-policy` prints it, and `sbx policy allow network <host>` adds a host. pi's `web_search` needs `mcp.exa.ai`. Which hosts sandboxes may reach is the person's call: name each one before adding it.

## Gotchas

- `sbx <command> --help` is the authority on its flags. A wrong flag binds a secret to the wrong scope without an error
- `CLAUDE_CODE_SUBAGENT_MODEL` must stay unset: it can override the model each rendered agent names (anthropics/claude-code#10993)

## Check

`test -f ~/.config/sbx/credentials.yaml && echo ok` prints `ok`, `echo "${CLAUDE_CODE_SUBAGENT_MODEL:-unset}"` prints `unset`, and `sbx policy inspect local-policy` lists every host the person approved.
