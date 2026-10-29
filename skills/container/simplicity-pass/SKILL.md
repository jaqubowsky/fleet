---
name: simplicity-pass
description: 'The simplicity pass over a branch''s whole diff: dead code, needless layers and the comments it added. Use in every round that wrote code, once its code is written and before its checks run.'
compatibility: Requires added-comments
---

# Simplicity pass

Code written slice by slice carries more than the finished change needs: a layer an earlier slice wanted, a prop the final caller never passes, a key the last screen stopped reading. The pass reads the finished diff as the person who maintains it next, and every added line that does no work comes out. It runs once per round, before the checks, so the checks and the review run on the code that stays.

## 1. The range

The branch's whole diff against the base its pull request targets: `git diff --merge-base origin/<base>` plus the untracked files. That is every commit on the branch, other authors' commits included, and the work not yet committed.

## 2. Comments

Run `added-comments origin/<base>`. It prints each comment line the range adds, as `added` or `changed`, and skips a comment that moved unchanged with its code.

- An `added` line goes. What it said goes into a name, the structure, a test name or the commit body.
- A `changed` line goes back to its text on the base, `git show origin/<base>:<file>`, with only a name the branch renamed updated.

Done when it prints nothing and exits 0.

## 3. Patterns

Every case of each pattern in the range comes out: code that is dead, including a route or registration that leads nowhere; speculative, a parameter, option or generic no caller uses; a pass-through layer or a one-caller helper with no rule of its own; rebuilt technical code the repository or a dependency already has; hand-rolled data flow the repository's data layer or a computed value already gives; defensive code for a failure no test or run showed; and duplicate, the same rule twice inside one module. Before calling something unused, `git grep` its name across the repository. A module's entry file that declares its public surface is a boundary, not a pass-through.

Done when every pattern has its cases fixed, and the tests of the changed files pass again.

## Report

One block in the closing message, a row per pattern, each case found and what replaced it, or `none found`:

```text
simplicity pass  origin/main...HEAD + working tree
comments         removed 9 lines in 3 migrations; added-comments prints nothing
dead             59 pl and 47 en translation keys; unused styles in journal.module.scss
speculative      JournalEntryForm prop onReverse, no caller passes it
pass-through     api ledger/handlers.ts: the router calls the reads directly
rebuilt          none found
hand-rolled data fetchEntries page loop became useInfiniteQuery
defensive        early return and mpkId check on an already filtered match; trim
duplicate        none found
```
