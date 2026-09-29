# <NN>: <Ticket title>

Status: ready-for-agent
Blocked by: <NN>-<slug>.md, or "None, can start immediately"

## Parent

The spec this ticket belongs to, when there is one. Read it first: it carries the sources and decisions the whole feature shares.

## Outcome

What works when this ticket is done, from the user's side, end to end through every layer it touches. Never a layer-by-layer list.

## Scope

What this ticket changes, and the sources only this slice needs: the issue, ADR or review comment that constrains it, the code it copies from.

## Out of scope

One line each: what a reader might expect here and another ticket, or nobody, delivers.

## Acceptance criteria

- [ ] <given state or input> -> <observable outcome, with its concrete value>
- [ ] <what the change refuses or leaves untouched at its boundary> -> <observable outcome>
- [ ] Seen: <what a user sees, when the ticket changes it>

Each criterion is an invariant a test asserts as written: its expected value comes from here, never from the code.

## Notes

Optional: a decision this slice made, a prototype snippet trimmed to that decision.

In a tracker the heading's title is the issue title and the tracker's key its only number, `Status:` is the issue's workflow state, `Blocked by:` is the tracker's blocking relation with landed blockers left out, and the description starts at `## Parent`; its local copy puts the heading and `Status:` back above it.

A ticket holds the plan, never progress: progress lives in the tracker and in git; a local copy's `Status:` is the container's working mark.
