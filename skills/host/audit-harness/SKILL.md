---
name: audit-harness
description: 'Review a coding session for friction, mistakes and slack. Suggest the smallest harness changes, backed by evidence. Report only; nothing is edited.'
disable-model-invocation: true
---

# Audit harness

Improve the agent's environment at `{{root}}`, not its compliance score. End with proposals; changes are the user's call.

## 1. Read the session

Use the session the user names, or the current session by default. Session stores and extraction commands are in [references/extract.md](references/extract.md). Include child transcripts when the problem occurred in delegated work. Read enough surrounding messages to establish the task, outcome and what led to the problem.

## 2. Find friction

Look for mistakes, repeated commands, tool errors, user corrections, slow navigation, missing information and oversized tool results. Include instructions that were followed but produced a bad outcome, and the person's own habits that cost turns, such as a setting on the Mac that stops the work. Each candidate needs a quote and source line, or a measured tool-call count.

## 3. Find slack

Read the same runs for what the environment makes the agent and the person carry when nothing failed:

- Always-loaded instructions: the first `instructions` attachment lists each file the session carried. Name the largest by size, each sentence the runs show is a no-op, and reference only some branches reach, which belongs behind a pointer (progressive disclosure)
- A demand repeated across steers or the person's messages, with its count: it belongs in the skill, overlay or profile that would have carried it
- A step the agent does by hand from a runbook or a gotcha: it becomes a command
- Work the person did that the agent could have done, and a decision the agent took that was the person's
- Skills the runs need together that never name each other

Each candidate needs a quote and source line, a count or a size. If neither step finds a candidate, say so and stop.

## 4. Find the smallest fix

For each candidate, inspect the relevant harness source and check whether a solution already exists. Consult historical instructions only when the finding depends on what the session actually carried.

- Mechanical errors belong in deterministic checks. Inspect the project's declared checks, hooks and CI before proposing another one; an existing check that was not run may be the cause.
- Navigation and information gaps may need a pointer or access to an existing source.
- Instructions needing judgement may need deletion or clarification rather than another rule.
- Expensive tool calls may need narrower queries or output.

Prefer removing the cause over adding instructions or tooling. Check shared sources and both `pi/` and `claude/`; state when a proposal applies to only one. A candidate is ready when its evidence, cause, smallest fix and cost are known. Label an uncertain cause as unverified.

## 5. Report

Use [references/report.md](references/report.md). Order friction proposals by impact on safety and task completion, then wasted work, and slack by what it saves. Merge candidates with the same cause. Show the report in the conversation. Save it only if the user asks, in the artifacts directory rather than the working tree. Stop without editing the harness.
