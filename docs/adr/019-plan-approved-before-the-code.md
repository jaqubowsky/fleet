# Approve the Plan before the code

## Status

Accepted.

## Context

An order to deliver end to end let a container answer its own open decisions and go from the analysis straight into the code. On 2026-11-04 the person asked for the Plan to come after every analysis, as its last step once no question is left, with the approval depending on their order: the host on a task handed over end to end, the person on any other.

## Decision

Every delivery stops after the analysis. `analyze-task` ends on the open questions, and writes the Plan only once none is left. `deliver-ticket` starts its slices on a steer that approves the Plan, or on an order that approves it in advance. The container never needs to know who approved. The host's half, reading `analysis.md` against the ticket or showing the Plan to the person, is in `orchestrating-agent-sessions`.

`fleet bench` has no host to approve anything, and a run ends at its first settle, so its steer approves the Plan in advance.

## Consequences

A delivery costs at least one more steer than it did. A container on an end-to-end task now waits for the host at the Plan. Removing the advance approval from the bench steer would end every bench run at the analysis. No real container run has confirmed the new flow yet.
