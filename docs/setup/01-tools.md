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
| Herdr app | `command -v herdr-app hc` prints two paths | download it from https://herdr.dev and start it once; it puts `herdr-app` and `hc` in `~/.local/bin` |
| bash 5 | `bash --version` prints 5 or higher | `brew install bash`; macOS ships 3.2, and the test suite the setup runs needs 5, as the sandboxes have |
| Node 22.19 or newer | `node --version` | pi's minimum |

## Install

Ask the person which agents they will use: Claude Code, pi, or both. Install at least one. `sync.sh` sets up only the agents whose CLI is on `PATH`, so an agent installed later is set up by the next sync.

```bash
brew trust docker/tap && brew install docker/tap/sbx    # Docker Sandboxes, free locally
npm install -g @earendil-works/pi-coding-agent          # pi, if they use it
curl -fsSL https://claude.ai/install.sh | bash          # Claude Code, if they use it; updates itself
```

## Logins

Only for the agents installed above. Ask the person which model plans they pay for, then match the seats to them before anyone logs in. Each agent names one model per role in a seats file, as `"<seat>": { "model": "<provider>/<model>", "thinking": "<level>" }`:

- `claude/profiles/models.json` uses `anthropic/claude-opus-5-5[1m]` for the host and the sandboxes. A Claude plan without Opus or without the 1M context needs a model it has, such as the same id without `[1m]`
- `pi/profiles/models.json` uses `openai-codex/…`, OpenAI through a ChatGPT login. With no ChatGPT plan, give every seat a model from a provider they have, in the same `<provider>/<model>` form

Person:

- create a Docker account if they have none, start `sbx` once and sign in with it
- with Claude Code: start `claude` and log in
- with pi: start `pi` and run `/login` for the provider its seats name. It writes `~/.pi/agent/auth.json`, which never goes into git

## Check

- `command -v sbx herdr-app hc` prints three paths, and `command -v claude pi` prints the path of each agent the person chose
- `herdr-app status` prints the open window's layout and no errors
- `sbx version` prints v0.48.0 or newer; fleet reads the JSON lists sbx prints since 0.48, and `brew upgrade docker/tap/sbx` updates an older one
- `sbx ls` answers without an authentication error; if not, the person signs in to sbx again
- with pi: `test -f ~/.pi/agent/auth.json && echo ok` prints `ok`; if not, the login above is missing
