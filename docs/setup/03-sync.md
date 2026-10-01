# 3. Sync

`sync.sh` installs the harness for both agents: it renders their homes, writes Claude's host settings, links the guard hook, the status line, `fleet` and a `gh` wrapper into place, and builds both sandbox images.

## Before the first `--apply`

The render owns whole directories and replaces them on every run: `~/.claude/rules`, `refs`, `skills` and `agents`, and `~/.pi/skills`, `agent/refs`, `agent/agents` and `agent/themes`. The person's own files there are deleted. The dry run lists each as `remove`: show the person that list and copy what they want to keep.

In `~/.claude/settings.json` it writes only the keys `claude/profiles/host.json` names, and keeps the person's own hook entries beside the repository's. The previous file stays as `settings.json.bak`.

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

A profile that gives the sandbox a Linear server needs it registered once by hand, because `sync.sh` cannot read sbx's list: `sbx mcp add <name> --url https://mcp.linear.app/mcp/readonly`, or `https://mcp.linear.app/mcp` where the sandbox writes.

## Check

A second `./sync.sh` ends with `In sync: nothing to change.`, `npm test` and `npm run check` exit 0, and `jq -r '.hooks.PreToolUse[0].hooks[0].command' ~/.claude/settings.json` prints a path ending in `.claude/hooks/guard.sh`.
