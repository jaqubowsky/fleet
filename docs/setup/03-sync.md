# 3. Sync

`sync.sh` installs the harness for both agents: it renders their homes, writes Claude's host settings, links the guard hook, the status line, `fleet` and a `gh` wrapper into place, and builds both sandbox images.

## Before the first `--apply`

The render owns whole directories and replaces them on every run: `~/.claude/rules`, `refs`, `skills` and `agents`, and `~/.pi/skills`, `agent/refs`, `agent/agents` and `agent/themes`. The person's own files there are deleted. The dry run lists each as `remove`: show the person that list and copy what they want to keep.

In `~/.claude/settings.json` it writes only the keys `claude/profiles/host.json` names, and keeps the person's own hook entries beside the repository's. The previous file stays as `settings.json.bak`.

It links `host/herdr.toml` as herdr's config, `~/.config/herdr/config.toml`. A config the person already had stays beside it as `config.toml.bak`; tell them, since the repository's one sets its own theme and sounds.

`fleet` and the `gh` wrapper land in `~/.local/bin`, which must come first on the person's `PATH`, ahead of Homebrew. If their `~/.zshrc` lacks it, propose `export PATH="$HOME/.local/bin:$PATH"` there.

## Run

```bash
./sync.sh            # prints what it would change, changes nothing
./sync.sh --apply
herdr integration install claude
herdr integration install pi
npm test && npm run check
```

`sync.sh` ends with `== set up by hand`: what it found missing and cannot install itself. Each line names its fix.

From now on every host session runs `fleet profile --apply --brief` as it starts, which sets its checkout's git config the way the repository's profile says and registers the host's Linear server.

A profile with `container.linear` set to `read` or `write` names its sandbox Linear server in `container.linearServer`. Register each such name once by hand, because `sync.sh` cannot read sbx's list: `sbx mcp add <linearServer> --url https://mcp.linear.app/mcp/readonly` for `read`, or `https://mcp.linear.app/mcp` for `write`. No profile with Linear, nothing to do.

## Check

A second `./sync.sh` ends with `In sync: nothing to change.`, `npm test` and `npm run check` exit 0, `zsh -ic 'type gh'` ends with `gh is <home>/.local/bin/gh`, and `jq -r '.hooks.PreToolUse[0].hooks[0].command' ~/.claude/settings.json` prints a path ending in `.claude/hooks/guard.sh`.
