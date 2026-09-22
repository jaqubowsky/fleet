---
name: audit-harness
description: 'Audit this harness on its transcripts since the last audit: what held, what broke, what is missing, each with a quote, in a findings table with the smallest fix. Ends at a report; nothing is edited.'
disable-model-invocation: true
---

# Audit harness

Transcripts are the experiment; the harness (rules, skills, guard, fleet, image, settings) is the hypothesis. Grade the harness monorepo at `{{root}}`, a git repository whose `README.md` layout table names every part: the shared sources and the `pi/`, `omp/` and `claude/` parts. Ends at a report; every edit is the user's call.

## 1. New transcripts

`audits/ledger.tsv` under the root: `audited_at`, `path`, `verdict`, one line per audited transcript. Candidates: every task directory's `logs/sessions/**/*.jsonl` under `~/.sandboxes/*/*/` for containers, and the host session stores (`~/.pi/agent/sessions/`, `~/.omp/agent/sessions/`, `~/.claude/projects/`); `subagent-artifacts/*_transcript.jsonl` and `subagents/*.jsonl` belong to the session beside them. New = absent from the ledger and untouched for 10 minutes. None -> say so and stop. Print the groups (one per task directory or host file) with side, size and date, so the user can narrow the run.

The newest `audits/*.md` carries the findings of the last run into step 4: every row with its id, severity and run count. Declining a fix does not close a row.

## 2. Rules as they were

`git log -1 --before=<session start> --format=%h -- rules skills agents extensions sbx host pi omp claude` (the first commit when none precedes), then `git show <sha>:<path>` for `rules/*.md`, the container rule under `sbx/` and the skill descriptions. A Claude Code transcript lists the rule files it carried (`instructions` attachment); a pi or omp container carries what the render step folds into its `AGENTS.md`, a Claude container the rendered `~/.claude/rules`. A rule the session never carried is `not exercised`.

## 3. Scorecard per session

One `explorer` per session, all in the same turn. The brief: the paths, the commit, [references/extract.md](references/extract.md), and this shape as its done-check:

- header: path, side, model, task in one line, outcome (finished, died, stopped by the user)
- each rule: `held`, `broken` or `not exercised`; the first two with one quote and its transcript line
- each skill the task matched: `SKILL.md` read at which line, before or after the user named it; steps skipped
- friction with counts: a command repeated three or more times, tool errors, guard denials (correct or false positive), fleet refusals, user corrections verbatim

Done when every rule has a verdict and every `broken` has a line number. An explorer without one is sent back for it.

## 4. Findings

Open every `broken` quote yourself. Then one finding per defect across sessions, each under an id `<area>/<name>` whose area is one of rule, skill, guard, fleet, image, env, settings, docs, with:

- runs = audits whose evidence this id appeared in, this one included. Match a defect to an open row by its evidence, never by the row's wording; a third run raises the severity one step
- violations = sessions affected / sessions that exercised it
- severity: **high** = a boundary crossed or missed (push, sign, secret, Linear write) or no deliverable; **medium** = minutes, repeats or a user correction; **low** = wording or drift
- fix = the smallest change that removes the evidence: delete before rewrite, rewrite before add; a mechanism (script, guard case, trigger line) when a rule broke in every session that exercised it

Transcripts are not the only evidence; two defects leave none there:

- **dead**: a pointer the harness still carries and nothing can reach — a path, command, skill, tool or file name that no longer exists. Sweep the rules, container rule and skill descriptions step 2 reconstructed; a part the scorecards keep calling `not exercised` is where these collect.
- **wording**: a rule a session followed to the letter with a bad outcome. It scores `held` and disappears, and the sentence is what failed, not the agent.

Each takes a row like any other, quoting the harness line in place of a transcript one.

A defect earns a row only while the harness still carries it. Test every fix that landed since the last audit against this run's evidence, the fix itself, never the commit message:

- landed, evidence gone -> **closed**: one line under Open with the commit, no row
- landed, evidence still standing -> a row under the old id, `runs` + 1, saying what the fix missed
- no fix -> a row

An open row this run turned up no fresh evidence for keeps its id, severity and count and goes under Open, out of the findings table: the sessions either never exercised it or the harness moved around it. Say which.

A gap (a skill, command, tool or runbook note the sessions lacked) is a suggestion only with two sessions behind it and its cost stated; one session is a note.

## 5. Report

`audits/<YYYY-MM-DD>.md` per [references/report.md](references/report.md): verdict, findings table sorted by runs then severity then violations, evidence and the full fix per row, open rows, suggestions, held with one quote each, not exercised. Append the audited paths to the ledger. Print the verdict and the tables. Stop.
