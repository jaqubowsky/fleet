# <NN>: <Ticket title>

Status: ready-for-agent
Blocked by: <NN>-<slug>.md, or "None, can start immediately"

<Describe who is affected, what fails today, and one concrete example or source. Use a Problem heading when this needs more than a paragraph.>

## Outcome

<Describe precisely what works for the user after this ticket, through the layers it touches. Name the input, result and boundary; do not list implementation steps.>

<Explain the work and constraints the next agent needs to make that outcome hold. Link a spec, ADR or prior implementation where it matters. Use Work or Out of scope headings only when the content earns them.>

## Acceptance criteria

- [ ] Given <state or input>, when <action>, then <observable outcome with its concrete value>.
- [ ] <Adjacent behavior that must remain unchanged> -> <observable result>.

Each criterion is an invariant whose expected result comes from the ticket, not from the current code. A screen change is a normal criterion: the browser check derives its screen and state from the criterion and the diff, then records the opened frame as evidence. Do not add a separate visual checklist.

In a tracker, the heading's title is the issue title, its key is the only number, `Status:` is the issue's workflow state, and `Blocked by:` is the tracker's blocking relation with landed blockers left out. The local copy puts the heading and working `Status:` back above the description. Its full text remains available to a container without tracker access.

A ticket holds the plan, never progress: progress lives in the tracker and in git; a local copy's `Status:` is the container's working mark.
