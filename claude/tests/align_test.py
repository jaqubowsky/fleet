#!/usr/bin/env python3
import importlib.util
import contextlib
import io
import json
import tempfile
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
check("the fleet mod is enabled from this checkout's own marketplace folder", data["enabledPlugins"].get("fleet@harness") is True and data["extraKnownMarketplaces"]["harness"]["source"] == {"source": "directory", "path": str(align.REPO / "claude" / "mods")})
check("no $HARNESS is left unexpanded", "$HARNESS" not in json.dumps(data))
check("the compaction point comes from its one source", data["env"]["CLAUDE_CODE_AUTO_COMPACT_WINDOW"] == str(align.load(align.COMPACTION)["tokens"]))
check("a change of the repo source is reported", align.fix_user({**data, "autoCompactEnabled": False}) != [])

herdr = {"matcher": "^(startup|resume|clear|compact|fork)$", "hooks": [{"type": "command", "command": "bash ~/.claude/hooks/herdr-agent-state.sh session"}]}
stale = {"matcher": "Bash", "hooks": [{"type": "command", "command": str(align.HOME / ".claude" / "hooks" / "guard.sh"), "timeout": 10}]}
mine = {"hooks": {"SessionStart": [herdr], "PreToolUse": [stale]}}
align.fix_user(mine)
twice = json.loads(json.dumps(mine))
align.fix_user(twice)
starts = mine["hooks"]["SessionStart"]
guards = [entry for entry in mine["hooks"]["PreToolUse"] if entry["hooks"][0]["command"].endswith("guard.sh")]

check("a hook the person added, such as herdr's, survives the sync", herdr in starts)
check("the repo's own hook is added beside it", any(entry["hooks"][0]["command"].endswith("plugin-drift.sh") for entry in starts))
check("the repo's hook replaces its own stale entry instead of doubling it", len(guards) == 1 and guards[0]["matcher"] != "Bash")
check("a second sync changes nothing", twice == mine)

desired = align.desired_host()
source = align.load(align.HOST_SETTINGS)
check("the host settings name no MCP server and no managed-only key", "managedMcpServers" not in desired and "allowManagedMcpServersOnly" not in desired)
check("claude.ai skill and plugin sync stay off", desired.get("syncClaudeAiSkills") is False and desired.get("syncClaudeAiPlugins") is False)
check("gh opens and merges pull requests without the auto-mode classifier", all(rule in desired["permissions"]["allow"] for rule in ("Bash(gh pr create *)", "Bash(gh pr merge *)")))
check("the host runs without Claude Code's OS sandbox, as pi's does", "sandbox" not in desired)

with tempfile.TemporaryDirectory() as tmp:
    source = Path(tmp) / "herdr.toml"
    source.write_text("theme = 'repo'\n")
    target = Path(tmp) / "config" / "config.toml"
    target.parent.mkdir()
    target.write_text("theme = 'mine'\n")
    settings = Path(tmp) / "config" / "settings.json"
    settings.write_text("{}\n")
    with contextlib.redirect_stdout(io.StringIO()):
        align.install_link(source, target, True)
        align.process(settings, align.fix_user, True)
    check("the link and the settings replace a person's file with no .bak beside it", target.is_symlink() and settings.read_text() != "{}\n" and not list(target.parent.glob("*.bak")))

print(f"align-settings.py: {passed} passed, {len(failures)} failed")
sys.exit(1 if failures else 0)
