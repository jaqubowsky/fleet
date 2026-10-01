# 1. Tools and logins

## Requirements

Check all of them first and report the full list, passed and missing, in one message.

| Requirement | Check | Fix |
| --- | --- | --- |
| macOS 14 or newer on Apple Silicon | `sw_vers -productVersion` prints 14 or higher, `uname -m` prints `arm64` | none: sbx runs nowhere else |
| Homebrew | `command -v brew` | brew.sh |
| git, jq, python3, gh | `command -v git jq python3 gh` prints four paths | `brew install jq gh`; git and python3 come with the Xcode command line tools |
| Node 22.19 or newer | `node --version` | the repository is tested on Node 24 |
| A Docker account | ask the person | sbx signs in with it |

## Install

```bash
brew trust docker/tap && brew install docker/tap/sbx    # Docker Sandboxes, free locally
brew install herdr                                      # terminal workspace the agents run in
npm install -g @earendil-works/pi-coding-agent          # pi
curl -fsSL https://claude.ai/install.sh | bash          # Claude Code, updates itself
```

## Logins

Ask the person which model providers they pay for. The pi seats in `pi/profiles/models.json` use OpenAI through a ChatGPT login. With no ChatGPT plan, change those seats to a provider they have before they log in.

Person:

- start `sbx` once and sign in with the Docker account
- start `claude`, log in, and install the TypeScript LSP plugin from `claude-plugins-official` with `/plugin`. The Claude sandbox image copies it from `~/.claude/plugins/`, so building that image fails without it
- start `pi` and run `/login` for the provider its seats name. It writes `~/.pi/agent/auth.json`, which never goes into git

## Check

`command -v sbx herdr pi claude` prints four paths, `sbx ls` answers without an authentication error, and `test -f ~/.pi/agent/auth.json && test -d ~/.claude/plugins/cache/claude-plugins-official/typescript-lsp && echo ok` prints `ok`.
