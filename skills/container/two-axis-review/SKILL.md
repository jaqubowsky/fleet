---
name: two-axis-review
description: 'Independent review of one commit on two axes, correctness and engineering quality, by a reviewer that never saw the implementation. Use after the last commit of a piece of work before it is handed over, or when the user asks to review a branch, a PR or work in progress.'
compatibility: Requires git, jscpd for clone detection, and the `reviewer` sub-agent
---

Review the diff between `HEAD` and a fixed point on two axes: does the code fulfil the task, and is it engineered as this repo wants. One `reviewer` sub-agent does both; its context holds the task, the diff and the evidence you collect here, and nothing of how the implementation went. Its output is `review.md` in the task directory (`$FLEET_ARTIFACTS/$SANDBOX_NAME`, layout in `refs/artifacts.md`); with no task directory, `review.md` beside the repository's `.issues/`.

## Process

### 1. Pin the commit

The fixed point is what the user or the calling skill named: a commit, a branch, `main`, `HEAD~3`. Missing, ask for it. `git rev-parse <fixed-point>` and `git rev-parse HEAD` both resolve and `git diff <fixed-point>...HEAD --stat` is non-empty before anything else runs. Keep the range `<base-sha>...<head-sha>` in SHAs from here on: the review proves this head and no other. Set `status: reviewing` in `status.md`.

### 2. Gather the evidence

Into `logs/review-<head-sha7>/` in the task directory:

- `diff.patch`: `git diff <base>...<head>`, and `changed.txt`: `git diff --name-only --diff-filter=ACMR <base>...<head>`.
- `commits.txt`: `git log <base>..<head> --oneline`.
- `clones.txt`: the detector run once, per [clone-detection.md](clone-detection.md), its full JSON beside it. No detector is a line in `clones.txt` saying so.
- The checks: the gate command the work named, typecheck, lint, each run once with its output in a log here and its exit code noted in the task text. A check that will not run here is named as not run.

### 3. Name the standards

Repo documents on how code is written: `CODING_STANDARDS.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md`, `docs/`. Then the wiki at `/Users/alice/my-knowledge-base/wiki/`: read `index.md` and pick the pages for the diff's area, plus the four that bear on every review:

| Page | What it decides |
| --- | --- |
| `dry-principle.md` | one piece of knowledge or two: share technical, copy domain, "can these change independently?" |
| `ambiguous-architecture-terms.md` | the wording of findings: a pro and a con, or a measurement |
| `code-deletability.md` | a diff that adds or grows a module: delete its folder, count the errors and the silent stumps |
| `anti-requirements.md` | a diff that grows an entity or a type: invent a fake rule joining two attributes, see whether it sounds absurd |

Collect paths. The reviewer reads them, and [smells.md](smells.md) beside this file, itself.

### 4. Run the reviewer

One `reviewer` call, `output` set to the absolute path of `review.md`, `outputMode: "file-only"`. The task text carries, in this order: the range in SHAs; the task directory path and which of `task.md`, `analysis.md`, `spec.md`, `issues/` exist; the path of `logs/review-<head-sha7>/` and each file in it with the exit code of each check; the standards paths from step 3 with their precedence (repo, wiki, baseline) and the path of `smells.md`; the filtered clone list pasted in full. The reviewer reads everything it is given and returns `review.md` in the shape its own definition holds.

### 5. Hand back

Read `review.md`. In `status.md`: `commit:` the head, `status: implementing` when the verdict is BLOCK or a P1 stands, with each such finding as a new plan step; `status: testing` or `ready-for-host` otherwise. Report the verdict and the finding count per axis in chat, with the path of `review.md`. Fixes are the main agent's: a fix means a new commit and a new review of that commit, and the previous `review.md` is superseded by the next.

## Done

`review.md` names the head that is now `HEAD`, every file in `changed.txt` appears in it under a finding or under Correct, every clone pair is ruled on, every check in `logs/review-<head-sha7>/` appears under Checks read, and `status.md` moved.

## Why two axes in one reviewer

Code that follows every standard can implement the wrong thing, and code that does exactly what the ticket asked can break the project's conventions. The two sections stay separate in `review.md` so one verdict never hides the other; one reviewer holds both because both need the same diff, the same evidence and the same fresh eyes, and a second context would only pay for the diff twice.
