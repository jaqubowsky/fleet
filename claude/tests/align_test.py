#!/usr/bin/env python3
import importlib.util
import json
import sys
from pathlib import Path

TOOL = Path(__file__).resolve().parent.parent / "tools" / "align-settings.py"

spec = importlib.util.spec_from_file_location("align_settings", TOOL)
align = importlib.util.module_from_spec(spec)
spec.loader.exec_module(align)

failures = []


def check(name, condition):
    if condition:
        return
    failures.append(name)
    print(f"FAIL  align  {name}")


def managed(matcher):
    entry = {"hooks": [{"type": "command", "command": str(align.HOOK_TARGET), "timeout": 10}]}
    if matcher is not None:
        entry["matcher"] = matcher

    return {"hooks": {"PreToolUse": [entry]}}


data = managed("Bash|Read|Edit|Write|Grep|Glob")
changes = align.fix_managed(data)
entry = data["hooks"]["PreToolUse"][0]

check("stale matcher is rewritten", entry["matcher"] == align.HOOK_MATCHER)
check("stale matcher is reported", any("matcher" in change for change in changes))

data = managed(align.HOOK_MATCHER)
changes = align.fix_managed(data)

check("current matcher reports nothing", not [c for c in changes if "matcher" in c])

data = {"hooks": {"PreToolUse": []}}
align.fix_managed(data)
entry = data["hooks"]["PreToolUse"][0]

check("missing entry is registered on the full matcher", entry["matcher"] == align.HOOK_MATCHER)

kept = {
    "language": "Polish",
    "statusLine": {"type": "command", "command": "node ~/.claude/statusline.mjs"},
    "enabledPlugins": {align.LSP_PLUGIN: True},
}
model, effort = align.seat("host")
data = {**kept, "model": next(name for name in ("opus", "sonnet") if name != model), "effortLevel": next(level for level in ("low", "high") if level != effort)}
changes = align.fix_user(data)

check("host seat model reaches the user settings", data["model"] == model)
check("host seat effort reaches the user settings", data["effortLevel"] == effort)
check("both changes are reported", len([c for c in changes if "host seat" in c]) == 2)
check("every other key survives", all(data[key] == value for key, value in kept.items()))
check("nothing else is invented", set(data) == set(kept) | {"model", "effortLevel", "$schema"})
check("an aligned file reports no seat change", not [c for c in align.fix_user(dict(data)) if "host seat" in c])

profiles = json.loads(align.PROFILES.read_text(encoding="utf-8"))
private = {
    **profiles,
    "alice/private-app": {
        "host": {"sign": "none", "push": "auto", "pr": "auto", "merge": "auto", "linear": "write", "linearServer": "linear-private"},
        "container": {"push": "auto", "pr": "auto", "linear": "read", "linearServer": "linear-private-readonly", "token": "op://Dev/GitHub PAT private-app/credential"},
        "resources": {"memory": "4g", "cpus": "4"},
    },
}
context7 = {"type": "http", "url": "https://mcp.context7.com/mcp"}
data = {**managed(align.HOOK_MATCHER), "managedMcpServers": {"context7": context7}}
changes = align.fix_managed(data, json.dumps(private))

check("host Linear server joins the managed servers", data["managedMcpServers"].get("linear-private") == {"type": "http", "url": "https://mcp.linear.app/mcp"})
check("other managed servers survive", data["managedMcpServers"].get("context7") == context7)
check("host Linear server is reported", any("linear-private" in change for change in changes))

silent = {
    match: {**entry, "host": {**{key: value for key, value in entry["host"].items() if key != "linearServer"}, "linear": "none"}}
    for match, entry in private.items()
}
data = managed(align.HOOK_MATCHER)
align.fix_managed(data, json.dumps(silent))

check("profiles with no host Linear add no managed server", "managedMcpServers" not in data)

text, changes = align.desired_managed(json.dumps(private))
desired = json.loads(text)
source = align.load(align.REFERENCE)
excluded = desired["sandbox"]["excludedCommands"]

check("the live file is the repo's file plus what the profiles add", {k: v for k, v in desired.items() if k != "managedMcpServers"} == {k: v for k, v in source.items() if k != "managedMcpServers"})
check("the profiles' host Linear server reaches the live file", desired["managedMcpServers"].get("linear-private") == {"type": "http", "url": "https://mcp.linear.app/mcp"})
check("claude.ai skill and plugin sync stay off", desired.get("syncClaudeAiSkills") is False and desired.get("syncClaudeAiPlugins") is False)
check("cfleet up, build and land run outside the host sandbox", all(pattern in excluded for pattern in ("cfleet up*", "cfleet build*", "cfleet land*")))
check("gh opens, reads and merges pull requests outside the host sandbox", all(pattern in excluded for pattern in ("gh pr create*", "gh pr merge*", "gh pr view*", "gh pr checks*")))
check("no excluded command is listed twice", len(excluded) == len(set(excluded)))
check("a change the repo file alone makes is still reported", align.desired_managed()[1] != [])

print(f"align-settings.py: {4 + 6 + 4 + 7 - len(failures)} passed, {len(failures)} failed")
sys.exit(1 if failures else 0)
