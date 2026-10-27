---
name: boy-scout-rule
description: 'Leave the project notes a turn used truer and no longer than it found them: the runbook, the project overlay and the project skills. Use at the end of every turn that ran, followed or wrote an entry of them, before the closing message.'
---

# Boy scout rule

Leave the campsite cleaner than you found it, and only the part you walked through. Every later task acts on these notes before the code, so a stale entry misleads each of them, and an unpruned one settles as sediment.

## 1. The entries this turn used

From this turn's own commands and reads, not from memory, list each entry of the notes that the turn:

- ran: a command, a script, a query;
- followed: a selector, a route, a label, a port, an env value, a step order;
- obeyed: a rule that changed what it did;
- was misled by;
- wrote or edited, with the entries beside it under the same heading.

Reading a file through before the first gate uses none of its entries. Done when each listed entry names its file and heading.

## 2. A verdict per entry

The next task starts from the base branch, so the source is the base this turn last fetched, `origin/<base>`, never a local branch. Look a name up there with `git grep -F '<name>' origin/<base> -- <dir>` or `git show origin/<base>:<path>`. For behaviour, what this turn ran is the evidence.

| Verdict | When | The edit |
| --- | --- | --- |
| true | the code or this turn's run shows it hold | none |
| untrue | the code has moved on, or this turn saw it fail and named the cause | rewrite it to what the code shows, or delete it when nothing replaces it |
| duplicate | another entry states the same cause | merge both into the one where its scope is |
| history | it carries a date, a ticket id, a commit SHA, a count, a run-log path or a former state | rewrite it as today's design; the evidence stays in this turn's logs |
| recipe | this turn ran its steps by hand, one after another | a `run.sh` subcommand or a script in `runbook/bin/` that runs them, proven by this turn's run, and the entry shrinks to the line naming it |
| unverified | neither the code nor this turn's run decides it | none; the report names it |

An entry this turn's own branch makes untrue stays as it is until the branch merges, and the report carries its new text.

Done when every listed entry has a verdict and every edit its verdict calls for is made.

## 3. Where the edits land

The runbook is writable here: edit it in place. The project overlay and the project skills are copies whose source lives outside this container, so their edits go into the report as proposals: the file, the heading, the current text, the new text, and the command whose output shows it.

A fact this turn proved about an entry rewrites that entry, to state the step once as it stands today. `wc -w` each runbook file before its first edit and after its last; a file that grew carries a fact no entry held.

## Report

One block in the closing message:

```text
project notes                    words         edits
runbook/gotchas.md               4210 -> 4035  "Restarting vite" became run.sh restart web; deleted "Login asks for a code"
runbook/features/invoices.md      980 ->  940  rewrote "Totals cache": the key is cache:invoices:<org>:<id>
unverified   runbook/run.md, "Report export"
after merge  runbook/features/login.md, "Signing in": "<new text>"
proposed     overlay, "## Gates": "<current text>" -> "<new text>"; evidence: git grep -n typecheck origin/main -- scripts/ci
```
