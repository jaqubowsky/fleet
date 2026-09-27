---
name: resolving-merge-conflicts
description: "Use when you need to resolve an in-progress git merge/rebase conflict."
---

1. Where the two sides' intents cannot both stand, keep the side the merge's stated goal names (its pull request, its ticket, the branch it lands on), and write down in the commit or the report which side you dropped and why.

2. A rebase is done when `git status` shows no rebase in progress: after each resolved commit, `git rebase --continue`, until every commit is replayed.
