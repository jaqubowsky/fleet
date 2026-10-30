# Keep stopped containers separate from task status

## Status

Accepted.

## Context

The user wants to release container resources while keeping files and saved conversations. The task status `paused` already means an agent finished the step its order named. `sbx exec` starts stopped containers, so checkout probes can undo a stop.

## Decision

Use `fleet stop` and `fleet start` for both pi and Claude. A container is stopped when `sbx ls` says so; fleet keeps no record of its own. `fleet stop` runs `sbx stop`, logs the stop the task's runtime counts, then closes the agent's Herdr app tab with `hc kill` of its terminal. A failed `sbx stop` leaves the tab open. The watch reports `stopped` and suppresses probes and wakes until start succeeds. The guard refuses a bare `sbx stop`, which logs no stop.

`fleet start` opens a new tab in the repository's space, resuming the last saved agent conversation when one exists, and refuses a container whose agent still has a terminal. The tab runs `exec sbx run`, because Herdr app's `tab.new` and `space.new` fall back to a shell after their program: with `exec` the agent is the tab's program, so the tab closes when the agent exits and `fleet start` finds no terminal left. Its terminal gets `hc keep --off`, which turns off herdr-core's recovery of a lost program as a shell, so a terminal lost to a restart is not left behind as a labelled shell. Leave `status.md` unchanged. Read-only listing and inspection must not use `sbx exec` on stopped containers.

## Consequences

Stop ends guest processes and closes the tab. Restart does not restore an interrupted tool call, a development server or process memory. A container stopped outside fleet is stopped all the same, and `fleet start` resumes it; only its stop is missing from the runtime. A running container whose agent exited or whose tab was closed lists as `gone`, and `fleet start` opens a new tab for it.
