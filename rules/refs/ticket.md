# <NN>: <Ticket title>

Status: ready-for-agent
Blocked by: <NN>-<slug>.md, or "None, can start immediately"

<Describe who is affected, what fails today, and one concrete example or source. Use a Problem heading when this needs more than a paragraph.>

## Outcome

<Describe precisely what works for the user after this ticket, through the layers it touches. Name the input, result and boundary; do not list implementation steps.>

<Explain the work and constraints the next agent needs to make that outcome hold. Link a spec, ADR or prior implementation where it matters. Use a Work heading only when the content earns it.>

## Out of scope

- <What a reader could expect this ticket to touch and it leaves alone, with the reason>, or "None".

## Open questions

- <A decision no source settles> -> <the criterion or the work it decides>, or "None".

## Acceptance criteria

- [ ] <State or input>, <action>, <observable outcome with its concrete value>.
- [ ] <Boundary case: empty, at the limit, just past it, invalid> -> <observable outcome with its concrete value>.
- [ ] <Adjacent behavior that must remain unchanged> -> <observable result>.

The title states the change in a few words, imperative, the way it reads on a board: "Restore only the files deleted with a project", never the symptom.

Each criterion is an invariant whose expected result comes from the ticket, not from the current code. Write it in the ticket's language, in the form that reads clearest, Given/When/Then, an example input with its result, or a rule with its value, and spend the lines on boundary cases rather than more happy paths. A screen change is a normal criterion: name its original source, mounted route, organization or role, operated control and expected transition. The browser check uses that target and the diff, then records the opened frame as evidence. Do not add a separate visual checklist.

In a tracker, the heading's title is the issue title, its key is the only number, `Status:` is the issue's workflow state, and `Blocked by:` is the tracker's blocking relation with landed blockers left out. The local copy puts the heading and working `Status:` back above the description. Its full text remains available to a container without tracker access.

A ticket holds the plan, never progress: progress lives in the tracker and in git. A local copy's `Status:` is the host's; the container leaves it as it is and ticks each criterion with its evidence.
