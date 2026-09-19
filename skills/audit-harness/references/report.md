# Audit <YYYY-MM-DD>

Sessions: <n> new since <previous audit date or "first audit">: <path, side, model, task in five words>.

## Verdict

Three sentences: what held, what broke, the one change with the widest effect.

## Findings

| Id | Where | Finding | Runs | Violations | Severity | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| `rule/acceptance-5` | `rules/core.md:24` | <one line> | 2 | 3/3 | high | <one line> |

**`rule/acceptance-5`** <session>, line <l>: "<quote>". Cause: wording | mechanism | dead | conflict with <other>. Fix: <full replacement text, or the script, guard case or trigger line>. On a repeat, what the last audit proposed and what the evidence did since.

## Open

Rows with no fresh evidence this run: the sessions never exercised them, or the harness moved around them. Closed, the fix landed and the evidence is gone: `<id>` in `<commit>`.

| Id | First seen | Runs | Severity | Standing |
| --- | --- | --- | --- | --- |
| `guard/agents-md` | 2026-09-17 | 1 | high | not exercised: no session edited a rule |

## Suggestions

| # | Kind | Need shown | Sessions | Addition | Cost |
| --- | --- | --- | --- | --- | --- |
| 1 | skill | <done from scratch> | 2 | <name and trigger> | <lines, or a script> |

**1.** <sessions and lines that show the need; what the addition would have saved>.

## Held

One quote per rule, skill or mechanism that changed behaviour.

## Not exercised

Parts no session touched. One nothing could have touched is `dead`, and belongs in Findings.
