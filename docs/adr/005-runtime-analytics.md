# Separate stopped time from container runtime analytics

## Status

Accepted.

## Context

A container may remain stopped overnight and later resume the same task. The retained session timestamps alone include that pause in elapsed time. The previous Fleet event log recorded ownership and closure but not successful stops and starts. A long gap between tool results can also be a slow command or a provider wait rather than a stopped container.

## Decision

For pi and Claude, record creation and successful stop/start events in the existing Fleet event log. Creation carries a runtime schema marker. Attaching to an existing container remains an ownership event and does not restart its lifetime. Repeating a stop does not add another runtime event, and a failed stop or start does not record a successful transition.

At fleet down, extend the existing logs/usage.json with runtime coverage, elapsed time, running time, stopped time and stop/restart counts. Complete lifecycle records define the current container's measurement window for token usage and tool counts. Older or inconsistent records retain task-session usage and omit unmeasured running and stopped durations. The report names which scope it uses.

Include recorded tool calls and failures by tool and agent, plus the final task status, branch and head. Do not interpret failed tools as task accuracy or invent acceptance outcomes or TPS.

With complete runtime coverage, flag gaps between recorded tool completions that contain at least the existing 20-minute stall threshold of running time. Exclude stopped periods from that calculation. These gaps are candidates for investigation, not confirmed stalls. Keep running time as container uptime, including waits, rather than claiming active agent work or subtracting unexplained gaps.

## Consequences

The summary is derived from existing transcripts, activity and lifecycle records without copying their content. It can be regenerated while those records remain. Exact pause accounting requires the new creation marker and stop/start transitions through Fleet. Stops outside Fleet and unavailable history cannot be reconstructed. No per-request streaming timing is collected by this change, so TTFT and TPS remain unreported.
