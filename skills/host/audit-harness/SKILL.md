---
name: audit-harness
description: 'Review a coding session for friction and mistakes. Suggest the smallest harness changes, backed by evidence. Report only; nothing is edited.'
disable-model-invocation: true
---

# Audit harness

Improve the agent's environment at `{{root}}`, not its compliance score. End with proposals; changes are the user's call.

## 1. Read the session

Use the session the user names, or the current session by default. Session stores and extraction commands are in [references/extract.md](references/extract.md). Include child transcripts when the problem occurred in delegated work. Read enough surrounding messages to establish the task, outcome and what led to the problem.

## 2. Find friction

Look for mistakes, repeated commands, tool errors, user corrections, slow navigation, missing information and oversized tool results. Include instructions that were followed but produced a bad outcome. Each candidate needs a quote and source line, or a measured tool-call count. If the session shows no actionable problem, say so and stop.

## 3. Find the smallest fix

For each candidate, inspect the relevant harness source and check whether a solution already exists. Consult historical instructions only when the finding depends on what the session actually carried.

- Mechanical errors belong in deterministic checks. Inspect the project's declared checks, hooks and CI before proposing another one; an existing check that was not run may be the cause.
- Navigation and information gaps may need a pointer or access to an existing source.
- Instructions needing judgement may need deletion or clarification rather than another rule.
- Expensive tool calls may need narrower queries or output.

Prefer removing the cause over adding instructions or tooling. Check shared sources and both `pi/` and `claude/`; state when a proposal applies to only one. A candidate is ready when its evidence, cause, smallest fix and cost are known. Label an uncertain cause as unverified.

## 4. Report

Use [references/report.md](references/report.md). Order proposals by impact on safety and task completion, then wasted work. Merge candidates with the same cause. Show the report in the conversation. Save it only if the user asks, in the artifacts directory rather than the working tree. Stop without editing the harness.
