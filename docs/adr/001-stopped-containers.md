# Keep stopped containers separate from task status

## Status

Accepted.

## Context

The user wants to release container resources while keeping files, saved conversations and herdr tabs. The task status `paused` already means an agent finished the step its order named. `sbx exec` starts stopped containers, so checkout probes can undo a stop.

## Decision

Use `fleet stop` and `fleet start` for both pi and Claude. Store the saved pane ID in the task's `logs/sandbox-stop.json`. The watch reports `stopped` and suppresses probes, wakes and automatic continues until start succeeds. The guard refuses a bare `sbx stop`, which saves no pane.

In herdr the stopped tab is reported under the agent label `fleet`, with lifecycle state `unknown` and display label `stopped`, since herdr's lifecycle API has no stopped state. The label is not the agent's own: after the agent's process exits, herdr 0.9.1 ignores reports carrying that agent's label until it detects the agent again (`recent_agent_process_exit` in `set_hook_authority_at`). Stop waits until herdr has let the exited agent go, then runs `fleet stopped <sandbox>` in the tab under `HERDR_AGENT=<agent>`: a full-screen view of the stopped container, kept in the foreground because herdr 0.9.2 clears a self-reported agent once its pane is back at an idle shell. The view gives the tab its name back whenever herdr clears it, which it does while the exit is recorded. Start ends the view with ctrl+c before it resumes the agent.

Leave `status.md` unchanged. Restart in the saved pane, resuming the last saved agent conversation when one exists. Read-only listing and inspection must not use `sbx exec` on stopped containers.

## Consequences

Stop ends guest processes. Restart does not restore an interrupted tool call, a development server or process memory. The saved tab must still exist. Containers stopped outside fleet have no saved pane record and need `fleet up` to attach.
