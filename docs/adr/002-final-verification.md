# Verify the final tree after any required branch update

## Status

Accepted.

## Context

The FLO-1781 audit found that final acceptance had started before the required rebase. Updating the base then restarted verification and base checks. The user asked to run final visible acceptance, typecheck and the other final gates after the required branch update, and to limit document reads after a session handoff. Rebase is not the update method for every repository.

## Decision

For pi and Claude, keep regression tests and review gates with implementation. Before final verification, fetch the base once for an unpushed branch. Integrate an advanced base using the repository's branch-update rules, merging where merge commits are allowed and rebasing only where linear history requires it. If no update is needed, use the current HEAD. Record the base and HEAD and run final visible acceptance and the repository's final gates on that tree. A later base update is reported to the host rather than triggering another automatic branch update.

A fresh session resumes unfinished work from current task state and existing check evidence. Supporting documents are read separately, using the sections that the unfinished step needs. The resume instructions live in the shared container rule; the stock continue prompt points to that rule.

## Consequences

The host may receive a tested branch whose base is behind newer base-branch commits and must decide whether another update is needed. Per-ticket checks still run before the final gates. A handoff alone does not invalidate evidence for an unchanged tree. These instructions do not prove a reduction in tool calls or verification time; that needs a subsequent task run.
