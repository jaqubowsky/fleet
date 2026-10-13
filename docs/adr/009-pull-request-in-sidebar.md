# Show a container's pull request in herdr's sidebar through the relay

## Status

Accepted. Narrows the pull request line of [007](007-state-from-herdr.md): `fleet ls` and the wake still read none.

## Context

The person wanted to see, from herdr's sidebar, which pull request each container had opened. Herdr 0.9.1 shows a pane's metadata token in an agent row through a `$name` entry, and `herdr pane report-metadata <pane> --source <id> --token pr=#2390` sets one on a Claude pane without `--applies-to-source`. A container cannot reach the host's herdr socket. Until now only pi ran through `fleet relay`, the host process that hands herdr what a container writes into its task directory. Claude's tab ran `sbx run` itself, so no host process followed a Claude container. Asking GitHub from the host for each container's branch would cost one request per container per check, and it would bring back the pull request reads 007 removed.

## Decision

For pi and Claude alike, `fleet up` and `fleet start` run the container's agent through `fleet relay`. In the container, the tool hook of each agent writes `logs/pull-request.json` with the number when a command containing `gh pr create` prints a `https://github.com/<owner>/<repo>/pull/<n>` URL: Claude's `PostToolUse` hook reads it from `stdout`, pi's `tool_result` handler from the result text. The relay reads that file every 500 ms. It passes a positive whole number to herdr as the pane's `pr` token under the source `fleet:pr`. It drops anything else, because the container writes the file. The relay leaves the file in place at start, so a container that comes back from `fleet stop` shows its pull request again. The host's `herdr.toml` places `$pr` in the agent row.

## Consequences

The sidebar shows the last pull request the container's agent opened with `gh pr create`. It does not show a pull request opened by hand or from the host, or whether that pull request was merged or closed. A multi-repository container shows only the last one. Claude containers now get herdr's variables and `FLEET_AGENT_STATE` like pi does, and nothing in them reads those. The hooks reach a container only after `fleet build` and a new container. The relay change reaches the next `fleet up` or `fleet start` as soon as the harness checkout has it.
