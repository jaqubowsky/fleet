#!/usr/bin/env python3
import fnmatch
import importlib.util
import json
import sys
from pathlib import Path

TOOL = Path(__file__).resolve().parent.parent / "tools" / "align-settings.py"

spec = importlib.util.spec_from_file_location("align_settings", TOOL)
align = importlib.util.module_from_spec(spec)
spec.loader.exec_module(align)

failures = []
passed = 0


def check(name, condition):
    global passed
    if condition:
        passed += 1
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

text, changes = align.desired_managed()
desired = json.loads(text)
source = align.load(align.REFERENCE)
excluded = desired["sandbox"]["excludedCommands"]

check("the live file is the repo's file, so a host Linear server a profile names leaves the machine-wide config", desired == source and "managedMcpServers" not in desired)
check("claude.ai skill and plugin sync stay off", desired.get("syncClaudeAiSkills") is False and desired.get("syncClaudeAiPlugins") is False)
check("fleet up, build, land and down run outside the host sandbox", all(pattern in excluded for pattern in ("fleet up*", "fleet build*", "fleet land*", "fleet down*")))
check("gh opens, reads and merges pull requests outside the host sandbox", all(pattern in excluded for pattern in ("gh pr create*", "gh pr merge*", "gh pr view*", "gh pr checks*")))
check("gh lists runs and pull requests and reads a run outside the host sandbox", all(pattern in excluded for pattern in ("gh run list*", "gh run view*", "gh pr list*")))
check("gh api is not excluded from the host sandbox, since -f, -F and --input make it a write", not [pattern for pattern in excluded if fnmatch.fnmatch("gh api repos/o/r -f a=b", pattern)])
check("the host sandbox reaches the GitHub API and no other new host, so gh reads run in a pipeline", desired["sandbox"]["network"]["allowedDomains"] == ["login.docker.com", "api.github.com"])
check("the host sandbox lets gh verify TLS through trustd", desired["sandbox"].get("enableWeakerNetworkIsolation") is True)
check("no excluded command is listed twice", len(excluded) == len(set(excluded)))
check("gh opens and merges pull requests without the auto-mode classifier", all(rule in desired["permissions"]["allow"] for rule in ("Bash(gh pr create *)", "Bash(gh pr merge *)")))
check("a change the repo file alone makes is still reported", align.desired_managed()[1] != [])

print(f"align-settings.py: {passed} passed, {len(failures)} failed")
sys.exit(1 if failures else 0)
