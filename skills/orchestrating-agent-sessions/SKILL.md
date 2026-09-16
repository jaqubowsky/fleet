---
name: orchestrating-agent-sessions
description: 'Use when the user asks to put up, list, inspect, prompt, land or close fleet containers (sbx sandbox plus a herdr tab running pi), or asks what a [fleet] status line means.'
---

# Fleet containers

One container per task: a private clone in an sbx sandbox with pi waiting in a herdr tab. The user prompts it there. The rules for when this session may prompt one are in the Fleet section of your rules.

| Ask | Command | Result to report |
| --- | --- | --- |
| put up a container for ticket X | `fleet up <label> --repo <path> [--branch <name>]` | sandbox name, tab name; pi waiting, no prompt sent |
| what is running | `fleet ls` | one line per container: status, herdr state, branch, dirty count |
| what did it do | `fleet peek <sandbox>` | git status, log, diff --stat, pane tail |
| send it this | `fleet say <sandbox> "<text>"` | prompt logged and sent |
| run something inside | `fleet exec <sandbox> -- <command>` | command output |
| get a file out | `fleet copy <sandbox>:<path> <local>` | local path |
| bring the branch home | `fleet land <sandbox> [--sign]` | log and diff --stat of the imported branch |
| close it | `fleet down <sandbox>` | transcript path |
| switch models | `fleet provider [<name>]` | files rewritten; host sees it after `/reload` |

The `fleet_watch` tool (or `/fleet-watch [names]` typed by the user) starts the monitor over the agents that exist at that moment, so call it again after every `fleet up`: every status change of another agent arrives as `[fleet] <name>: <prev> -> <status>`. `gone` means the pane or tab closed. Report the line and stop, unless the user put that container in the follow mode of Fleet rule 3; `blocked` means the user has a dialog to answer in that tab.

`fleet down` refuses twice: on a dirty tree (the user commits in the tab, or `--force` discards) and on commits that never reached the host repo (`fleet land` first, or `--force` discards). Show `fleet peek` and let the user decide.

`fleet up` fails after `pi did not come up`: read the tab with `herdr agent read <pane> --source recent-unwrapped --lines 60` and report what it printed.
