# Extracting a transcript

Both formats are JSONL, one object per line. Never `cat` a file: sizes reach 8 MB. Pipe through `jq` and slice with `.[0:N]`. `nl` on the extracted stream gives line numbers for the scorecard; the number is the transcript line when the filter keeps one output per input line, so print `input_line_number` where it matters.

## pi (`~/.pi/agent/sessions`, `~/.sandboxes/*/pi-*/logs/sessions`)

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

## Claude Code (`~/.claude/projects`, `~/.claude/sandbox-transcripts`)

Top-level `.type` in `user`, `assistant`, `attachment`, `system`. `.message.content` is a string or an array of parts with `.type` in `text`, `tool_use`, `tool_result`, `thinking`.

```bash
jq -r 'select(.type=="assistant") | .message.model' "$f" | sort | uniq -c
jq -c 'select(.type=="attachment") | .attachment | select(.type=="instructions") | .files' "$f" | head -1
jq -r 'select(.type=="user") | .message.content | if type=="string" then . else (.[]? | select(.type=="text") | .text) end' "$f"
jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="text") | .text' "$f"
jq -c 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | {name, input: (.input|tostring|.[0:200])}' "$f"
jq -c 'select(.type=="user") | .message.content[]? | select(.type=="tool_result") | {is_error, content: (.content|tostring|.[0:300])}' "$f"
```

Skill loads are `Skill` tool calls or `Read` calls on a `SKILL.md` path. Sub-agent briefs are `Agent` tool inputs; their transcripts sit in `subagents/` beside the parent. Written code is the `input` of `Edit` and `Write` calls: that is where comments and commit subjects are graded.

## Counts that grade a rule

- Restatement before the first mutation (Communication): first assistant text before the first `edit`/`write`/`Edit`/`Write` call.
- Done-check after the last change (Acceptance): last mutating call versus the last test or check command.
- Repeats (friction): `sort | uniq -c | sort -rn` over the extracted tool calls.
- Push, sign, Linear writes (Autonomy): grep the tool calls for `git push`, `-S`, `gpgsign`, and MCP names containing `create` or `update`.
- Sub-agents (Delegation): count of `scout`/`researcher`/`reviewer` tool calls in pi, `Agent` calls in Claude, against what the session's skill asked for.
