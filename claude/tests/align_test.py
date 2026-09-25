#!/usr/bin/env python3
import importlib.util
import json
import sys
import tempfile
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

data = managed(align.HOOK_MATCHER)
align.fix_managed(data)

check("claude.ai skill and plugin sync are off", data.get("syncClaudeAiSkills") is False and data.get("syncClaudeAiPlugins") is False)
check("sync already off reports nothing", not [c for c in align.fix_managed(data) if "claude.ai" in c])

data = {**managed(align.HOOK_MATCHER), "sandbox": {"enabled": True, "excludedCommands": ["git push*"]}}
align.fix_managed(data)
excluded = data["sandbox"]["excludedCommands"]

check("cfleet up, build and land run outside the host sandbox", all(pattern in excluded for pattern in align.FLEET_OUTSIDE))
check("earlier excluded commands survive", excluded[0] == "git push*" and data["sandbox"]["enabled"] is True)
check("excluded cfleet commands report nothing the second time", not [c for c in align.fix_managed(data) if "excludedCommands" in c])

with tempfile.TemporaryDirectory() as tmp:
    copy = Path(tmp) / "managed-settings.json"
    copy.write_text('{"stale": true}\n', encoding="utf-8")
    live = json.dumps(managed(align.HOOK_MATCHER), indent=2) + "\n"

    changed = align.mirror_reference(copy, live, True)

    check("stale reference copy is refreshed", copy.read_text(encoding="utf-8") == live)
    check("refreshed reference copy is reported", changed)
    check("current reference copy reports nothing", not align.mirror_reference(copy, live, True))

print(f"align-settings.py: {4 + 6 + 4 + 2 + 3 + 3 - len(failures)} passed, {len(failures)} failed")
sys.exit(1 if failures else 0)
