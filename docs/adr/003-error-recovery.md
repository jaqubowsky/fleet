# Clear automatic error stops after confirmed recovery

## Status

Accepted.

## Context

FLO-1851 resumed tool execution after a provider error while status.md still carried the automatic stop. Its coordinator received three identical blocked notifications in 84 seconds despite a working pane. A later termination was a separate error that still needed reporting.

## Decision

For pi and Claude, record the task phase before an automatic error stop. A successful tool from the main agent clears only the automatic error attention. If the status is still blocked, restore the phase from status history. Preserve a phase the agent already updated. Failed tools and child-agent tools do not establish recovery, and manual blockers remain unchanged.

Deduplicate blocked notifications using the existing task-status, branch-facts and steer comparison. A changed error, changed task state, changed branch facts or a new steer can notify again. A new provider error replaces an earlier automatic stop but never a manual blocker.

## Consequences

A successful main-agent tool proves resumed execution, not completion of the task or repair of the provider. The recovery does not add a continuation, retry or push. Status history retains both the error and the recovery. Restoring a blocked phase requires a recorded phase from before the automatic stop.
