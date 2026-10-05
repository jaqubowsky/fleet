# Keep stopped containers separate from task status

## Status

Accepted.

## Context

The user wants to release container resources while keeping files, saved conversations and herdr tabs. The task status `paused` already means an agent finished the step its order named. `sbx exec` starts stopped containers, so checkout probes can undo a stop.

## Decision

Use `fleet stop` and `fleet start` for both pi and Claude. Store the saved pane ID in the task's `logs/sandbox-stop.json`. Report a stopped agent to herdr with lifecycle state `unknown` and display label `stopped`, since herdr's lifecycle API has no stopped state. The watch reports `stopped` and suppresses probes, wakes and automatic continues until start succeeds.

Leave `status.md` unchanged. Restart in the saved pane, resuming the last saved agent conversation when one exists. Read-only listing and inspection must not use `sbx exec` on stopped containers.

## Consequences

Stop ends guest processes. Restart does not restore an interrupted tool call, a development server or process memory. The saved tab must still exist. Containers stopped outside fleet have no saved pane record and need `fleet up` to attach.
