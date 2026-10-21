# Extracting a transcript

Both formats are JSONL, one object per line. Never `cat` a file: sizes reach 8 MB. Pipe through `jq` and slice with `.[0:N]`. Use jq's `input_line_number` before filtering to preserve source lines; numbering the filtered output does not identify transcript lines.

## Finding the sessions

Every store at once, by modification time and size; filter on the day, or grep a sandbox name for one task's transcripts:

```bash
setopt nullglob
stat -f '%Sm %z %N' -t '%F_%T' ~/.claude/projects/*/*.jsonl ~/.pi/agent/sessions/*/*.jsonl \
  ~/.fleet/tasks/*/*/logs/sessions/*.jsonl ~/.fleet/tasks/*/*/logs/sessions/projects/*/*.jsonl \
  | awk '$1 ~ /^<YYYY-MM-DD>/' | sort
```

Transcript timestamps are UTC; git commit times are local. Convert before saying whether a session ran before or after a commit.

## pi (`~/.pi/agent/sessions`, `~/.fleet/tasks/*/pi-*/logs/sessions`)

First line is `{"type":"session","cwd":...}`; `model_change` names provider and model. Messages sit under `.message` with `role` in `user`, `assistant`, `toolResult`.

```bash
jq -c 'select(.type=="session" or .type=="model_change") | {type, cwd, provider, modelId, timestamp}' "$f"
jq -r 'select(.type=="message" and .message.role=="user") | .message.content[]? | select(.type=="text") | .text' "$f"
jq -r 'select(.type=="message" and .message.role=="assistant") | .message.content[]? | select(.type=="text") | .text' "$f"
jq -c 'select(.type=="message" and .message.role=="assistant") | .message.content[]? | select(.type=="toolCall") | {name, arguments: (.arguments|tostring|.[0:200])}' "$f"
jq -c 'select(.type=="message" and .message.role=="toolResult") | .message | {toolName, isError, content: (.content|tostring|.[0:300])}' "$f"
jq -c 'select(.type=="message" and .message.role=="toolResult") | .message | select(.isError) | {toolName, content: (.content|tostring|.[0:400])}' "$f"
```

Guard denials are `toolResult` entries whose content names the policy reason. Skill loads are `read` calls on a `SKILL.md` path. `git commit` subjects sit in `bash` arguments.

## Claude Code (`~/.claude/projects`, `~/.fleet/tasks/*/claude-*/logs/sessions`)

Top-level `.type` in `user`, `assistant`, `attachment`, `system`. `.message.content` is a string or an array of parts with `.type` in `text`, `tool_use`, `tool_result`, `thinking`.

```bash
jq -r 'select(.type=="assistant") | .message.model' "$f" | sort | uniq -c
jq -c 'select(.type=="attachment") | .attachment | select(.type=="instructions") | .files' "$f" | head -1
jq -r 'select(.type=="user") | .message.content | if type=="string" then . else (.[]? | select(.type=="text") | .text) end' "$f"
jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="text") | .text' "$f"
jq -c 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | {name, input: (.input|tostring|.[0:200])}' "$f"
jq -c 'select(.type=="user") | .message.content[]? | select(.type=="tool_result") | {is_error, content: (.content|tostring|.[0:300])}' "$f"
```

Skill loads are `Skill` tool calls or `Read` calls on a `SKILL.md` path. Sub-agent briefs are `Agent` tool inputs; their transcripts sit in `subagents/` beside the parent. Written code is the `input` of `Edit` and `Write` calls.

### Condensing many transcripts

For more than a couple of Claude transcripts, condense each to text first and read or delegate the text. [`../scripts/condense.jq`](../scripts/condense.jq) prints one line per event, starting with its source line: `L<n> <time> U:` user text, `A:` assistant text, `T <tool>:` call, `R:` or `R!ERR:` result, `SYS`, `ATT`, each long field cut with the count it dropped. Two days of 18 transcripts and their sub-agents went from 430 MB to 6 MB. Write the transcript paths into a list file and loop over it; the guard refuses a glob or a variable that could expand to the fleet's config:

```bash
while read -r f; do
  jq -r -f <this skill>/scripts/condense.jq "$f" > "<scratchpad>/condensed/$(basename "$f" .jsonl).txt"
done < "<scratchpad>/files.txt"
```

Sub-agent transcripts sit in `<session id>/subagents/*.jsonl`; condense them the same way.
