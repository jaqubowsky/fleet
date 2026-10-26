---
name: modernize
description: 'Bringing an old pull request up to date with its base, or recommending it be closed. Use when the order says to modernize or refresh a pull request that fell behind its base.'
---

# Modernize a pull request

A clean rebase proves the commits still apply, not that the pull request still belongs in the product. Decide that first, and rebase only a pull request worth keeping. Every step writes into `modernize.md` where your seat's rules keep outputs.

Where `origin` is another local checkout rather than GitHub, `origin/<base>` is only as fresh as that checkout's last fetch. Compare `git rev-parse origin/<base>` with `gh api repos/<owner>/<repo>/branches/<base> --jq .commit.sha` before anything else: when they differ, the fetch that checkout owes is an open question, and nothing below runs on the stale base.

## 1. The goal

Read the pull request whole: `gh api repos/<owner>/<repo>/pulls/<number> --jq '{title, body, state, base: .base.ref, head: .head.sha, author: .user.login}'`, its commits, its full diff against the merge base, its review threads and the issue it links. Done when `modernize.md` holds the head SHA, the merge base `git merge-base origin/<base> <head>`, and one or two sentences naming the smallest goal the pull request serves.

## 2. What moved on the base

The base commits since the merge base, `git log --oneline <merge-base>..origin/<base>`, and the ones touching this pull request's files, `git log --oneline <merge-base>..origin/<base> -- <files>`. Merged and open pull requests on the same files or the same behaviour: `gh pr list --repo <owner>/<repo> --state all --search '<term>'`. A missing conflict says nothing here: the questions are about meaning.

- Did a base commit or another pull request already solve the same problem?
- Did an API, type, schema or dependency the pull request uses change shape?
- Was the code it changes deleted, moved or simplified on purpose?
- Would landing it bring back behaviour the base removed, or add a second way to do one thing?

Done when each question has an answer citing a commit or a pull request, or the search that found none.

## 3. The disposition

One of three, with the evidence from step 2:

- **MODERNIZE**: the goal still holds and the implementation keeps its shape. Step 4 runs.
- **REWORK**: the goal still holds, but a rebase would carry the wrong implementation forward. Name the smallest rewrite that reaches the goal on today's base, and stop.
- **CLOSE**: the base or another pull request made it obsolete, or its benefit no longer pays for its upkeep. Stop; the pull request closes only on the user's word.

Age and the work already in a pull request are no evidence either way. A rework runs only when the order asks for it.

## 4. The rebase

An order to modernize is the user's word for this rebase. The rebase turns the next push into a forced one, which follows your seat's push permission.

1. `git branch modernize-before <head>`, so the pre-rebase series stays readable.
2. `git rebase origin/<base>`, each conflict resolved for the goal from step 1. A conflict that shows the base and the pull request disagree about the product goes back to step 3 as REWORK.
3. `git range-diff <merge-base>..modernize-before origin/<base>..HEAD`. Done when every commit pairs with its old self, and every change the range-diff shows inside a pair is a conflict resolution you can name.
4. The slice tests of the files the pull request touches, and every test that imports them, run once on the rebased head.

## Closing message

It opens with the disposition and its reason in one line, then:

- the base commits and pull requests that bear on this one
- the conflicts in meaning step 2 found, or that it found none
- the range-diff result and the checks, in the container's check table
- whether the branch was pushed, and the pull request link
