# 1. Tools and logins

## Requirements

Check all of them first and report the full list, passed and missing, in one message.

| Requirement | Check | Fix |
| --- | --- | --- |
| macOS 14 or newer | `sw_vers -productVersion` prints 14 or higher | none: sbx runs nowhere else |
| Apple Silicon | `uname -m` prints `arm64` | none: sbx runs nowhere else |
| zsh as the login shell | `echo $SHELL` ends in `zsh` | `chsh -s /bin/zsh`; the setup edits `~/.zshrc` and checks with `zsh -ic` |
| Homebrew | `command -v brew` | brew.sh |
| git, jq, python3, gh | `command -v git jq python3 gh` prints four paths | `brew install jq gh`; git and python3 come with the Xcode command line tools |
| Node 22.19 or newer | `node --version` | pi's minimum |

## Install

```bash
brew trust docker/tap && brew install docker/tap/sbx    # Docker Sandboxes, free locally
brew install herdr                                      # terminal workspace the agents run in
npm install -g @earendil-works/pi-coding-agent          # pi
curl -fsSL https://claude.ai/install.sh | bash          # Claude Code, updates itself
```

## Logins

Ask the person which model plans they pay for, then match the seats to them before anyone logs in. Each agent names one model per role in a seats file, as `"<seat>": { "model": "<provider>/<model>", "thinking": "<level>" }`:

- `claude/profiles/models.json` uses `anthropic/claude-opus-5-5[1m]` for the host and the sandboxes. A Claude plan without Opus or without the 1M context needs a model it has, such as the same id without `[1m]`
- `pi/profiles/models.json` uses `openai-codex/…`, OpenAI through a ChatGPT login. With no ChatGPT plan, give every seat a model from a provider they have, in the same `<provider>/<model>` form

Person:

- create a Docker account if they have none, start `sbx` once and sign in with it
- start `claude`, log in, and install the TypeScript LSP plugin from `claude-plugins-official` with `/plugin`. The Claude sandbox image copies it from `~/.claude/plugins/`, so building that image fails without it
- start `pi` and run `/login` for the provider its seats name. It writes `~/.pi/agent/auth.json`, which never goes into git

## Check

- `command -v sbx herdr pi claude` prints four paths
- `sbx ls` answers without an authentication error; if not, the person signs in to sbx again
- `test -f ~/.pi/agent/auth.json && test -d ~/.claude/plugins/cache/claude-plugins-official/typescript-lsp && echo ok` prints `ok`; if not, the matching login or plugin above is missing
