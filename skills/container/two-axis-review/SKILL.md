---
name: two-axis-review
description: 'Independent review of one diff for correctness and engineering quality, by a reviewer that never saw the implementation. Use on uncommitted work before its commit, or when the user asks to review a branch, a PR or work in progress.'
compatibility: Requires git, jscpd for clone detection, and the `reviewer` sub-agent
---

Review one diff, uncommitted work over `HEAD` or `HEAD` against a fixed point: does the code fulfil the task, and is it engineered as this repo wants. One `reviewer` sub-agent does both; its context holds the task, the diff and the evidence you collect here, and nothing of how the implementation went. Its output is `review.md` in the task directory (`$FLEET_ARTIFACTS/$SANDBOX_NAME`, layout in {{refs}}); with no task directory, `review.md` beside the repository's `.issues/`.

## Process

### 1. Pin the diff

For uncommitted work, from `implement` or named by the user: `git add -A -N` so new files show, then `git diff HEAD --stat` is non-empty before anything else runs, and the range is `<HEAD-sha>..working tree`. Otherwise the fixed point is what the user named: a commit, a branch, `main`, `HEAD~3`. Missing, ask for it. `git rev-parse <fixed-point>` and `git rev-parse HEAD` both resolve and `git diff <fixed-point>...HEAD --stat` is non-empty before anything else runs. Keep the range `<base-sha>...<head-sha>` in SHAs from here on: the review proves this head and no other.

### 2. Gather the evidence

Into `logs/review-<head-sha7>/` in the task directory:

- `diff.patch`: `git diff <base>...<head>`, and `changed.txt`: `git diff --name-only --diff-filter=ACMR <base>...<head>`; for uncommitted work, `git diff HEAD` in both.
- `commits.txt`: `git log <base>..<head> --oneline`; none for uncommitted work.
- `clones.txt`: the detector run once, per [clone-detection.md](clone-detection.md). No detector is a line in `clones.txt` saying so.
- The checks: the logs `implement` step 7 wrote on this same uncommitted tree, named with their exit codes and not run again. Otherwise, and for typecheck or lint that gate left out, the gate command the work named, typecheck, lint, each run once with its output in a log here and its exit code noted in the task text. A check that will not run here is named as not run.
- A check log past 200 lines, repo-wide output such as a formatter's, gets its cut beside it here: `grep -F -f changed.txt <log> > <log>.changed`, the lines that name a changed file.

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

{{file:review-call}} The task text carries, in this order: the range in SHAs; the task directory path and which of `analysis.md`, `spec.md`, `issues/` exist, and when none does, the prompt that set the task, quoted; the path of `logs/review-<head-sha7>/` and each file in it except `pairs.tsv` and a log that has a `.changed` cut, and each check log from step 2 with its exit code, by its cut where it has one; the standards paths from step 3 with their precedence (repo, wiki, baseline) and the path of `smells.md`; then `clones.txt` itself, the file's content inside one fenced block, so the reviewer reads the pairs. Every claim in the brief is a file in the evidence directory, quoted. The reviewer reads everything it is given and returns `review.md` in the shape its own definition holds.

### 5. Hand back

Read `review.md`. Report its `PASS` or `FAIL` line and the finding count per axis in chat, with the path of `review.md`. Fixes are the main agent's, and this review is the only one. Fix each finding that carries a smallest fix and close it with its evidence: a test that fails without the fix, or a log path and line. A `plausible` or `unverified` finding whose break no test or trace reproduces closes as not reproduced, unbuilt. Leave each `host:` finding unbuilt: its fix leaves the task. A product decision, whether the reviewer wrote it as `host:` or as a smallest fix, is a question for the user under `attention:`, not a fix. An item under Not covered that names work still to come goes into the file that work starts from. When a fix changed the tree, the gate command runs once more on it. Then `review.md` gets this addendum for those findings:

```md
## Closed after review

- P<0-2> <finding>: fixed, <test name, or log path:line>
- P<0-2> <finding>: host, <why its fix leaves the task>
- P<0-2> <finding>: not reproduced, <the test or trace that stayed green>
- P<0-2> <finding>: user, <the question under attention:>
- `<gate command>`: exit <n>, <log path>
- Unreviewed: <each file a fix added outside `changed.txt`, or none>
```

Checks after commit or rebase keep their detail in check logs or a new browser run report. `status.md` records one turning point with a pointer to that evidence, not the individual checks. The Range stays pinned to the diff the reviewer inspected. A fix that reaches files the reviewer never saw closes here too: the Unreviewed line names them, and the next review covers its own ticket's diff or a range the user names.

## Done

`review.md` names the range step 1 pinned, every file in `changed.txt` appears in it under a finding or under Correct, every clone pair is ruled on, every check step 2 named appears under Checks read, and Shared seams lists every modified symbol other callers use or says none. Once the fixes are in, the addendum names every finding with its evidence, its `host:` reason, its question or the check that did not reproduce it, and fills the Unreviewed line.

