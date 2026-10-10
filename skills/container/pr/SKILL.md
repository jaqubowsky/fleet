---
name: pr
description: 'Writing a pull request body. Use when a pull request is opened, and when a later round changes what its body says.'
---

# Pull request body

The reader is a reviewer on GitHub who has the diff and this body, nothing else. The body answers three questions in order: what changed, what proves it works, what merging risks. Name things in the repository's own terms, those of its `CONTEXT.md` when it has one.

## Template

```markdown
[FLO-1906](https://linear.app/<workspace>/issue/FLO-1906)

## Summary

<one or two sentences, then the visual>

## Evidence

- **Before:** <the failing test and its assertion, or the number measured>
  **After:** <the same test passing, or the same number measured again>

## Merge danger

**Door:** <one-way or two-way>, <why, in one line>

**Blast radius:** <one word>, <who or what breaks if this is wrong>

- <what this does not fix, one line each>
- <each review finding left open, one line each>
```

## Tracker issue

The first line is the tracker issue the change delivers, its identifier as the link text and the issue's URL as the target, so the tracker's GitHub integration links the pull request. An issue with no URL you can read from the ticket goes in as the bare identifier; a URL is never built from a guess. A change with no tracker issue has no first line.

A closing keyword such as `Closes` or `Fixes` can change the issue's state on merge, so use one only where the repository's merged pull requests already do.

## Summary

One or two sentences say what changed, then the smallest visual that makes it clear, placed next to the sentence it supports. A pull request carrying independent changes in separate commits gives each its own bullet, naming the commit, with its own visual.

The default visual is a `diff` sketch over the shape the change touches, keeping only the calls, files, props and states the point needs:

```diff
 approveDocuments
   applyApproval
-  setStatus("approved")
+  setStatus(response.status)
+  if response.status is pending
+    keep the row selectable
```

```diff
 src/
 ├── cache/
+│   └── generation.ts   # per-organization generation token
-└── scan.ts
```

Reach for another form when the diff sketch hides the point:

- pseudocode for a new algorithm, when most of it is new
- the whole block, when omitted context would hide ownership or order
- a Mermaid `sequenceDiagram`, when the point is the order of calls between several parts; GitHub renders it

## Evidence

Each item is a check the reviewer can read in the diff or repeat. Show before and after.

1. A test that failed before the change and passes after it: its name, its file as a repository path, and the assertion in one line or pseudocode.
2. A number measured before and after on the same workload, with what was measured and where in the same line, so a local measurement never reads as a production one.
3. A screenshot, only where the environment can attach one to GitHub. A change a user sees that was checked in the running app with no image to attach gets one line saying what was checked.

Every path in the body is relative to the repository root, and every link opens for a GitHub reader: a file in the diff, a commit, a check run. The `file://` form used in replies points at a machine the reviewer cannot reach.

Gate output, suite counts, compiler diagnostic counts, baseline attribution and the run's own mechanics stay in `review.md` and the closing message. One of them reaches the body only when the reviewer will meet it on GitHub: a CI check that also fails on the base gets one line under merge danger, naming it as failing on the base.

## Merge danger

The door is one-way when a revert cannot undo what merging did: data dropped or rewritten, a message sent, an external contract changed, data written in a shape the old code cannot read. Otherwise it is two-way, and a revert restores the previous behaviour.

The blast radius is one word for the widest thing that breaks if the change is wrong, then who meets it: consumers of an API, a layout on mobile, a background job, every organization's cache.

Below them, one line each, sits everything the reviewer weighs next to the merge decision:

- what the change does not fix, including a reported problem it does not explain
- each review finding left open, with the reason
- each CI check that fails on the base too
- what was not verified

## Sending it

Write the body to a file outside the working tree. Open the pull request with `gh pr create --body-file <file>`.

A later round that changes what the body says rewrites it whole in this shape against the new head, and the pull request round sends it with its `gh api -X PATCH` call. A bot may append its own block to the body between HTML comment markers, such as `<!-- This is an auto-generated comment: release notes by coderabbit.ai -->`; the rewrite keeps that block as it found it, after the template's sections.
