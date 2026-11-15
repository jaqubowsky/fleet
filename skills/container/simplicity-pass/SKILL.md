---
name: simplicity-pass
description: 'The pass over a branch''s whole diff before its review: comments, dead code, guards for cases that cannot happen, a rule written twice. Use in every round that wrote code, once its code is written and before its checks run.'
compatibility: Requires touched-comments
---

# Simplicity pass

Code written slice by slice carries more than the finished change needs. The pass takes it out before the review, so the review and the checks run once, on the code that stays.

## 1. The range

The branch's whole diff against the base its pull request targets: `git diff --merge-base origin/<base>` plus the untracked files. That is every commit on the branch, other authors' commits included, and the work not yet committed.

## 2. Tools

What a tool finds, the tool finds first.

- `touched-comments --added origin/<base>` prints each comment line the range adds, as `added` or `changed`. An `added` line goes. A `changed` line goes back to its text on the base, `git show origin/<base>:<file>`, with only a name the branch renamed updated.
- `touched-comments --all origin/<base>`, the mode for a repository that keeps no comments, prints each comment line in every file the range touches, and each one goes.
- The repository's unused-code check, where its scripts declare one, such as `knip`: what it reports inside the range goes.

A comment that seems needed marks code to simplify: what it said goes into a name, the structure or a test name. Neither mode prints a line a tool reads, such as a lint or type directive, or a license header.

Done when `touched-comments` prints nothing in the mode used and exits 0.

## 3. Four reads

Read the range once for each, and take every case out:

1. A guard, fallback, retry or default for a case no caller, test or run reaches.
2. Dead code, which nothing reads. `git grep` the name across the repository before calling it unused.
3. The same rule, constant or shape written twice in what the range adds.
4. Code unlike the rest of its file: another pattern, naming or structure than the code around it uses for the same job.

Done when every read has its cases fixed, and the tests of the changed files pass again.

## Report

One block in the closing message: the range, the comment mode with what it removed, then one line per case taken out with what replaced it. A pass that took nothing out reports `none found` in one line.

```text
simplicity pass  origin/main...HEAD + working tree
comments         --added: removed 9 lines in 3 migrations; touched-comments prints nothing
unused           knip: 59 pl and 47 en translation keys
unreachable      early return and mpkId check on an already filtered match
twice            VAT rounding in invoice.ts and export.ts became roundVat
unlike           fetchEntries page loop became useInfiniteQuery, as the other lists do
```
