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

with tempfile.TemporaryDirectory() as tmp:
    copy = Path(tmp) / "managed-settings.json"
    copy.write_text('{"stale": true}\n', encoding="utf-8")
    live = json.dumps(managed(align.HOOK_MATCHER), indent=2) + "\n"

    changed = align.mirror_reference(copy, live, True)

    check("stale reference copy is refreshed", copy.read_text(encoding="utf-8") == live)
    check("refreshed reference copy is reported", changed)
    check("current reference copy reports nothing", not align.mirror_reference(copy, live, True))

print(f"align-settings.py: {4 + 6 + 3 - len(failures)} passed, {len(failures)} failed")
sys.exit(1 if failures else 0)
