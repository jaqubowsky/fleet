# 3. Sync

`sync.sh` installs the harness for each agent whose CLI is on `PATH`: it renders its home and builds its sandbox image. For Claude Code it also writes the host settings and links the guard hook and the status line. Whichever agents are installed, it links `fleet`, a `gh` wrapper and the Herdr app layout and mods into place. An agent it skips gets a line under `== set up by hand`, such as `skipped pi: no pi on PATH`; if the person meant to use it, step 1 installs it and the next sync sets it up.

## Before the first `--apply`

The render owns whole directories and makes them match this repository on every run: `~/.claude/rules`, `refs`, `skills` and `agents`, and `~/.pi/skills`, `agent/refs`, `agent/agents` and `agent/themes`. The person's own files there are deleted, and only the backup archive below keeps them. The dry run lists each as `remove`: show the person that list before the first `--apply`.

In `~/.claude/settings.json` it writes only the keys `claude/profiles/host.json` names, and keeps the person's own hook entries beside the repository's.

It links `host/herdr-app/layouts/fleet.json` and each folder of `host/herdr-app/mods/` into `~/.config/herdr-app`, and Herdr app loads them while it runs. The person's own settings, keys and themes there stay theirs. Ask them to pick the `fleet` layout once, in Settings or with `ctrl-shift-l`: its Agents pane shows a container's pull request and stopped containers, and its tab bar's Changes button shows what the container changed. It copies the file icons of `host/herdr-app/icons/` to `~/.config/herdr-app/fleet-icons/`, because Herdr app draws no image through a symlink. It also links `host/herdr-core/config.toml` to `~/.config/herdr-core/config.toml`, whose `notes = false` keeps hc from wrapping a steer in `<hc from=...>` tags, so the agent reads the text as typed and a steer of `/quit` runs that command.

Everything fleet keeps on the Mac lives under `~/.fleet`: `config/` from step 2, `tasks/` with one folder per sandbox, `cache/<agent>/`, `backups/` and `state/`.

Before `--apply` changes anything, it packs every existing file it will write, replace or delete into one archive, `~/.fleet/backups/<UTC timestamp>.tar.gz`, and prints its path. It keeps the newest 10. The dry run ends by naming the archive it would write. To get files back, list the archive and extract what is wanted, into a scratch directory first:

```bash
tar -tzf ~/.fleet/backups/<timestamp>.tar.gz
mkdir -p /tmp/restore && tar -xzf ~/.fleet/backups/<timestamp>.tar.gz -C /tmp/restore
tar -xzf ~/.fleet/backups/<timestamp>.tar.gz -C ~      # everything back in place
```

`fleet` and the `gh` wrapper land in `~/.local/bin`, which must come first on the person's `PATH`, ahead of Homebrew. If their `~/.zshrc` lacks it, propose `export PATH="$HOME/.local/bin:$PATH"` there.

## Run

```bash
./sync.sh            # prints what it would change, changes nothing
./sync.sh --apply
npm test && npm run check
```

`sync.sh` ends with `== set up by hand`: what it found missing and cannot install itself. Each line names its fix.

Every host session runs `fleet profile --apply --brief` as it starts, which sets its checkout's git config the way the repository's profile says and registers the host's Linear server.

A profile with `container.linear` set to `read` or `write` names its sandbox Linear server in `container.linearServer`. Register each such name once by hand, because `sync.sh` cannot read sbx's list: `sbx mcp add <linearServer> --url https://mcp.linear.app/mcp/readonly` for `read`, or `https://mcp.linear.app/mcp` for `write`. No profile with Linear, nothing to do.

## Check

A second `./sync.sh` ends with `In sync: nothing to change.`, `npm test` and `npm run check` exit 0, `herdr-app status` names the `fleet` layout with no errors, and `zsh -ic 'type gh'` ends with `gh is <home>/.local/bin/gh`. With Claude Code, `jq -r '.hooks.PreToolUse[0].hooks[0].command' ~/.claude/settings.json` prints a path ending in `.claude/hooks/guard.sh`.
