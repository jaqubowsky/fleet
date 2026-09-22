# Clone detection

How step 2 collects clone evidence, and what the flags do. Duplicated Code is the one baseline smell a tool finds better than a reader, and the one a reader misses in the direction that matters: code in the diff that repeats something already sitting elsewhere in the repo, outside the diff.

Run the detector once, in the skill, before the reviewer is called, into the evidence directory the skill names:

```bash
REPORT="$FLEET_ARTIFACTS/$SANDBOX_NAME/logs/review-<head-sha7>"
jscpd --silent --no-tips --reporters json --output "$REPORT" \
  --min-tokens 50 --cross-formats js-ts \
  --ignore "**/__snapshots__/**,**/fixtures/**,**/*.generated.*" . > /dev/null
jq -r '
  .duplicates[]
  | "\(.firstFile.name):\(.firstFile.start)-\(.firstFile.end) ~ \(.secondFile.name):\(.secondFile.start)-\(.secondFile.end) (\(.lines) lines)"
' "$REPORT/jscpd-report.json" | grep -F -f "$REPORT/changed.txt" > "$REPORT/clones.txt"
```

The `grep -F -f` is the whole filter: keep a clone pair only when at least one side is a file the diff touched. Paths in the report are relative to the scan root, so they match what `git diff --name-only` prints. `clones.txt` is what the brief pastes; the JSON stays beside it.

## Five rules bind this step

- **Evidence, not verdict.** jscpd matches tokens; DRY is about knowledge. Two token-identical blocks living in two bounded contexts are two pieces of knowledge and stay copied. When that is the call, the finding says so, so the next review doesn't raise it again.
- **Rule each pair with the recorded test**, in `/Users/alice/my-knowledge-base/wiki/dry-principle.md`: share technical code, copy domain code even when identical today, and ask whether the two sides can change independently. A pair that can is two pieces of knowledge. The page also names the unit that is safe to share: a policy or a calculator before a whole handler.
- **At least one side in the diff.** A clone pair entirely outside the change is pre-existing and out of scope.
- **Skip what a machine wrote.** Generated clients, fixtures, snapshots, migrations, lockfiles.
- **No detector, no failure.** If jscpd isn't installed, `clones.txt` says so in one line and the reviewer judges duplication by reading.

## What the flags do

Verified against jscpd 5.2.0, the version the container image installs. Re-check when `jscpd --version` prints another.

- `--ignore` takes **comma-separated plain globs**. Brace expansion is not supported: `**/{a,b}/**` silently matches nothing. Inside a git repo `.gitignore` is honoured by default, so `node_modules`, `dist` and `coverage` need no entry.
- `--cross-formats js-ts` catches the same logic living in a `.js` and a `.ts` file, which the default per-format pass never compares.
- `--silent --no-tips` still writes a one-line summary and the promo footer to stdout, hence the `> /dev/null`; the report always lands at `<output>/jscpd-report.json`.
- `--min-tokens 50` is the starting point; drop to 30 for dense TypeScript, raise to 100 in a repo full of framework boilerplate.
- Never pass `--threshold`: it exits 1 on exceed, and a repo-wide duplication percentage is not what this axis asks.
- Drowning in cross-module domain clones in a monorepo: `--skip-isolated "packages/a|packages/b"` drops clones spanning folders you have already decided are separate contexts. Encode the decision once instead of re-arguing it every review.
