# Show a container's pull request in the Agents pane

## Status

Accepted. Narrows the pull request line of [007](007-state-from-agent-status.md): `fleet ls` and the wake still read none.

## Context

The person wanted to see, in Herdr app's Agents pane, which pull request each container's agent had opened, and to open it from there. Asking GitHub from the host for each container's branch would cost one request per container per check, and it would bring back the pull request reads 007 removed. A Herdr app mod can read files on the host, and the container's task directory is on the host. The shipped `agents` mod draws each row from the tab's name and the agent's status and has no place for data of its own; shipped mods are read-only.

## Decision

For pi and Claude alike, the tool hook of each agent in the container writes `logs/pull-request.json` with the number and URL when a command containing `gh pr create` prints a `https://github.com/<owner>/<repo>/pull/<n>` URL: Claude's `PostToolUse` hook reads it from `stdout`, pi's `tool_result` handler from the result text. The `fleet` layout's sidebar shows `fleet-agents`, a clone of the shipped `agents` mod made with `mod.clone`. Every 15 seconds it reads that file for each terminal that carries a `fleet.task` label. In the row of that terminal's agent it shows a `PR #<n>` pill only for a URL of exactly that shape whose number is a positive whole number equal to the file's `number`, and a click opens that URL. It drops anything else, because the container writes the file. A stopped container has no terminal, so the same 15-second read also runs `sbx ls --json` and lists each stopped sandbox with a workspace under `~/.fleet/tasks/<repo>` in a Stopped section, with the pill from `~/.fleet/tasks/<repo>/<sandbox>/logs/pull-request.json`. The row only shows; `fleet start` brings the container back.

## Consequences

The Agents pane shows the last pull request the container's agent opened with `gh pr create`. It does not show a pull request opened by hand or from the host, or whether that pull request was merged or closed. A multi-repository container shows only the last one. Herdr app never updates the clone, so a change to the shipped `agents` mod reaches `fleet-agents` only when the harness copies it by hand; its `mod.json` records the version it was cloned from. The hooks reach a container only after `fleet build` and a new container; the pill reaches every tab as soon as the harness checkout has it.
