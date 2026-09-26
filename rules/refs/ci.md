# CI

Reached when a pull request's CI decides the next step: accepting it, merging it, or waiting out a round.

1. The GitHub token is fine-grained, and a fine-grained token cannot hold the Checks permission; only a GitHub App can. So `gh pr checks` fails, and GraphQL `statusCheckRollup` returns its check nodes as `null` beside a `FORBIDDEN` error while its `state` counts those holes. Neither tells you anything about CI
2. The SHA is the full 40-character head: `gh pr view <n> --json headRefOid --jq .headRefOid`. A short SHA matches no run, so it reads as "no CI yet" forever
3. CI is the Actions runs on that head: `gh run list --commit <sha> --json status,conclusion,name`. An empty list means the runs have not registered yet, which is pending too; still empty minutes after the push, read the workflow triggers before waiting on. Green is every run `completed` with conclusion `success`, `skipped` or `neutral`
4. Inside a container `origin` points at the host checkout, so both calls there take `--repo <owner>/<repo>`
