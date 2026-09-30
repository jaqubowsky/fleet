#!/usr/bin/env python3
import fnmatch
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

TOOL = Path(__file__).resolve().parent.parent / "tools" / "align-settings.py"

spec = importlib.util.spec_from_file_location("align_settings", TOOL)
align = importlib.util.module_from_spec(spec)
spec.loader.exec_module(align)

align.OVERLAY = Path(tempfile.mkdtemp()) / "none.json"

failures = []
passed = 0


def check(name, condition):
    global passed
    if condition:
        passed += 1
        return
    failures.append(name)
    print(f"FAIL  align  {name}")


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
check("nothing else is invented", set(data) == set(kept) | set(align.load(align.HOST_SETTINGS)) | {"model", "effortLevel", "$schema"})
check("an aligned file reports no change", align.fix_user(json.loads(json.dumps(data))) == [])

guard = data["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
check("the guard hook reaches the user settings at an absolute path under this HOME", guard == str(align.HOME / ".claude" / "hooks" / "guard.sh"))
check("no $HOME is left unexpanded", "$HOME" not in json.dumps(data))
check("a change of the repo source is reported", align.fix_user({**data, "autoCompactEnabled": True}) != [])

desired = align.desired_host()
source = align.load(align.HOST_SETTINGS)
excluded = desired["sandbox"]["excludedCommands"]

check("the host settings name no MCP server and no managed-only key", "managedMcpServers" not in desired and "allowManagedMcpServersOnly" not in desired)
check("claude.ai skill and plugin sync stay off", desired.get("syncClaudeAiSkills") is False and desired.get("syncClaudeAiPlugins") is False)
check("fleet up, build, land and down run outside the host sandbox", all(pattern in excluded for pattern in ("fleet up*", "fleet build*", "fleet land*", "fleet down*")))
check("gh opens, reads and merges pull requests outside the host sandbox", all(pattern in excluded for pattern in ("gh pr create*", "gh pr merge*", "gh pr view*", "gh pr checks*")))
check("gh lists runs and pull requests and reads a run outside the host sandbox", all(pattern in excluded for pattern in ("gh run list*", "gh run view*", "gh pr list*")))
check("gh api is not excluded from the host sandbox, since -f, -F and --input make it a write", not [pattern for pattern in excluded if fnmatch.fnmatch("gh api repos/o/r -f a=b", pattern)])
check("the host sandbox reaches the GitHub API and no other new host, so gh reads run in a pipeline", desired["sandbox"]["network"]["allowedDomains"] == ["login.docker.com", "api.github.com"])
check("the host sandbox lets gh verify TLS through trustd", desired["sandbox"].get("enableWeakerNetworkIsolation") is True)
check("no excluded command is listed twice", len(excluded) == len(set(excluded)))
check("gh opens and merges pull requests without the auto-mode classifier", all(rule in desired["permissions"]["allow"] for rule in ("Bash(gh pr create *)", "Bash(gh pr merge *)")))
with tempfile.TemporaryDirectory() as scratch:
    overlay = Path(scratch) / "claude-settings.json"
    overlay.write_text(json.dumps({"env": {"SSH_AUTH_SOCK": "$HOME/agent.sock"}, "sandbox": {"network": {"allowUnixSockets": ["$HOME/agent.sock"]}}}))
    align.OVERLAY = overlay
    mine = align.desired_host()
    sockets = mine["sandbox"]["network"]["allowUnixSockets"]
    own = str(align.HOME / "agent.sock")

    check("the person's overlay adds a socket to the repo's list", sockets == desired["sandbox"]["network"]["allowUnixSockets"] + [own])
    check("the person's overlay sets an env value beside the repo's", mine["env"]["SSH_AUTH_SOCK"] == own and mine["env"]["FLEET_SEAT"] == "claude")

print(f"align-settings.py: {passed} passed, {len(failures)} failed")
sys.exit(1 if failures else 0)
