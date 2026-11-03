---
name: audit-harness
description: 'Review a coding session for friction, mistakes and slack. Suggest the smallest harness changes, each with evidence and the check that would settle it. Report only; nothing is edited.'
disable-model-invocation: true
---

# Audit harness

Improve the agent's environment at `{{root}}`, not its compliance score. End with proposals; changes are the user's call.

## 1. Read the session

Use the session the user names, or the current session by default, with its child transcripts when the problem occurred in delegated work. Session stores and extraction commands are in [references/extract.md](references/extract.md). A bench run, `~/.fleet/bench/runs/<tag>/<task>-<rep>/`, is a session too.

## 2. Find friction

Look for mistakes, repeated commands, tool errors, user corrections, slow navigation, missing information and oversized tool results. Include instructions that were followed but produced a bad outcome, and the person's own habits that cost turns, such as a setting on the Mac that stops the work.

## 3. Find slack

Read the same runs for what the environment makes the agent and the person carry when nothing failed:

- Always-loaded instructions: the first `instructions` attachment lists each file the session carried. Name the largest by size, each sentence the runs show is a no-op, and reference only some branches reach, which belongs behind a pointer (progressive disclosure)
- A demand repeated across steers or the person's messages, with its count: it belongs in the skill, overlay or profile that would have carried it
- A step the agent does by hand from a runbook or a gotcha: it becomes a command
- Work the person did that the agent could have done, and a decision the agent took that was the person's
- Skills the runs need together that never name each other

Each candidate of steps 2 and 3 needs a quote and source line, a count or a size. If neither step finds one, say so and stop.

## 4. Find the smallest fix

For each candidate, inspect the harness source and check whether a solution already exists; read the instructions the session carried when the finding depends on them. Mechanical errors belong in deterministic checks: inspect the project's declared checks, hooks and CI first, since an existing check that was not run may be the cause. Prefer removing the cause over adding instructions or tooling. Check shared sources and both `pi/` and `claude/`; state when a proposal applies to only one. Label an uncertain cause as unverified.

A new or reworded rule is a hypothesis: added lines often leave the behaviour unchanged, and some add work on other tasks. Name the cheapest check that could show the fix does nothing:

- One decision in one turn, such as stopping, reading a file before writing, or a phrase the text must not hold: a `fleet eval` case of kind `bad` with its control, laid out as `{{root}}/docs/adr/018-micro-evals.md` says; the runner renders the claude container rules only. It counts only if the current rules fail it in half its reps or more
- Behaviour spread over a ticket, such as repeat walks, screenshots or requests: the same count on ordinary tickets delivered before and after the change, from each task's `logs/usage.json` and its transcripts
- A model or seat swap: `fleet bench run` of both image tags on the same seeds, as `{{root}}/docs/adr/017-internal-benchmark.md` says
- A deletion: the rule's `guard` case on a variant without the rule

A check that does not exist yet is part of the proposal: draft the eval case, its source line, prompt, expectations and control, or name the count and the tickets it compares. A candidate is ready when its evidence, cause, smallest fix, check and cost are known.

## 5. Report

Use [references/report.md](references/report.md). Order friction proposals by impact on safety and task completion, then wasted work, and slack by what it saves. Merge candidates with the same cause. Show the report in the conversation, save it only if the user asks, and stop without editing the harness.
