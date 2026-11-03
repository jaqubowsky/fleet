# Session audit

Session: <source, harness, task and outcome>.

## Verdict

<The change worth making first and why, or no actionable finding.>

## Proposals

Repeat for each proposal, highest impact first:

### <Problem>

Evidence: <source URL, line and quote, or measured count>.

Cause: <what in the environment caused the problem; mark uncertainty>.

Fix: <smallest concrete change, its location and applicability to pi and Claude>.

Check: <the eval case or ticket count that settles it, and what the current rules score there when measured; for a check that does not exist yet, its draft: case kind, source line, prompt, expectations and control, or the count and the tickets it compares>.

Cost: <implementation or maintenance cost and what the change gives up>.

## Slack

Repeat for each candidate, largest saving first:

### <What to cut, move or automate>

Evidence: <source line and quote, count or size>.

Saving: <tokens, turns or steers per run it removes, measured where the runs allow>.

Change: <smallest change, its location and applicability to pi and Claude>.

Check: <the guard case or ticket count that shows nothing breaks without it>.

Cost: <what the change gives up>.
