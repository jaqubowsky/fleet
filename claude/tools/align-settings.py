#!/usr/bin/env python3
import argparse
import difflib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HOME = Path.home()
REPO = Path(__file__).resolve().parents[2]
USER_SETTINGS = HOME / ".claude" / "settings.json"
HOST_SEAT = REPO / "claude" / "profiles" / "models.json"
PROFILES = REPO / "host" / "repos.json"
MANAGED_SETTINGS = Path("/Library/Application Support/ClaudeCode/managed-settings.json")
REFERENCE = REPO / "claude" / "managed-settings.json"
HOOK_SOURCE = REPO / "claude" / "hooks" / "guard.sh"
HOOK_TARGET = HOME / ".claude" / "hooks" / "guard.sh"
DRIFT_SOURCE = REPO / "claude" / "hooks" / "plugin-drift.sh"
DRIFT_TARGET = HOME / ".claude" / "hooks" / "plugin-drift.sh"
HERDR_SOURCE = REPO / "host" / "herdr.toml"
HERDR_TARGET = HOME / ".config" / "herdr" / "config.toml"
DETECTION_SOURCE = REPO / "host" / "agent-detection"
DETECTION_TARGET = HOME / ".config" / "herdr" / "agent-detection"

ATTRIBUTION = {"sessionUrl": False, "commit": "", "pr": ""}
FLEET_OUTSIDE = ["cfleet up*", "cfleet build*", "cfleet land*"]
HOOK_MATCHER = "Bash|Read|Edit|Write|Grep|Glob|NotebookEdit|WebFetch|WebSearch|mcp__.*"
LSP_PLUGIN = "typescript-lsp@claude-plugins-official"
HOST_LINEAR = """
const { hostLinearServers, parseProfiles } = await import(`${process.argv[1]}/src/profile/profile.ts`);
process.stdout.write(JSON.stringify(hostLinearServers(parseProfiles(await new Response(process.stdin).text()))));
"""


def load(path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def dump(data):
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def seat(name):
    entry = load(HOST_SEAT)["seats"][name]

    return entry["model"].split("/", 1)[1], entry["thinking"]


def fix_user(data):
    changes = []
    data["$schema"] = "https://json.schemastore.org/claude-code-settings.json"

    plugins = data.setdefault("enabledPlugins", {})
    if plugins.get(LSP_PLUGIN) is not True:
        plugins[LSP_PLUGIN] = True
        changes.append(f"{LSP_PLUGIN} enabled (it was installed but off)")

    model, effort = seat("host")
    for key, value in (("model", model), ("effortLevel", effort)):
        if data.get(key) != value:
            data[key] = value
            changes.append(f"{key} set to {value} from the host seat")

    return changes


def registered(entries, script_name):
    return any(
        hook.get("command", "").endswith(script_name)
        for entry in entries
        for hook in entry.get("hooks", [])
    )


def host_linear(profiles):
    found = subprocess.run(
        ["node", "--input-type=module", "-e", HOST_LINEAR, str(REPO)],
        input=profiles, stdout=subprocess.PIPE, text=True, check=True,
    )

    return {name: {"type": "http", "url": url} for name, url in json.loads(found.stdout).items()}


def fix_managed(data, profiles=None):
    changes = []

    for name, server in host_linear(profiles if profiles is not None else PROFILES.read_text(encoding="utf-8")).items():
        if data.get("managedMcpServers", {}).get(name) != server:
            data.setdefault("managedMcpServers", {})[name] = server
            changes.append(f"host Linear server {name} set to {server['url']} in managedMcpServers from host/repos.json")

    if "disableBypassPermissionsMode" in data:
        value = data.pop("disableBypassPermissionsMode")
        data.setdefault("permissions", {})["disableBypassPermissionsMode"] = value
        changes.append("disableBypassPermissionsMode moved under permissions, where it is actually read")

    if data.get("attribution") != ATTRIBUTION:
        data["attribution"] = dict(ATTRIBUTION)
        changes.append("attribution aligned with the sbx template")

    for key in ("syncClaudeAiSkills", "syncClaudeAiPlugins"):
        if data.get(key) is not False:
            data[key] = False
            changes.append(f"{key} set to false, so claude.ai account skills and plugins stay off this host")

    excluded = data.setdefault("sandbox", {}).setdefault("excludedCommands", [])
    for pattern in FLEET_OUTSIDE:
        if pattern not in excluded:
            excluded.append(pattern)
            changes.append(f"sandbox.excludedCommands gains {pattern}: it needs docker, op or the container's git port")

    hooks = data.setdefault("hooks", {})

    entries = hooks.setdefault("PreToolUse", [])

    if not registered(entries, HOOK_TARGET.name):
        entries.append({
            "matcher": HOOK_MATCHER,
            "hooks": [{"type": "command", "command": str(HOOK_TARGET), "timeout": 10}],
        })
        changes.append(f"PreToolUse hook registered on {HOOK_MATCHER}")

    for entry in entries:
        if not registered([entry], HOOK_TARGET.name):
            continue
        if entry.get("matcher") == HOOK_MATCHER:
            continue

        entry["matcher"] = HOOK_MATCHER
        changes.append(f"PreToolUse matcher rewritten to {HOOK_MATCHER}")

    starts = hooks.setdefault("SessionStart", [])
    if not registered(starts, DRIFT_TARGET.name):
        starts.append({
            "hooks": [{"type": "command", "command": str(DRIFT_TARGET), "timeout": 15}],
        })
        changes.append("SessionStart hook registered for plugin drift")

    return changes


def report(path, before, after, changes):
    print(f"\n=== {path}")

    if before == after:
        print("  nothing to change")
        return False

    if not changes:
        changes = ["reformatted (same settings, canonical JSON)"]

    for change in changes:
        print(f"  - {change}")

    diff = difflib.unified_diff(
        before.splitlines(keepends=True),
        after.splitlines(keepends=True),
        fromfile="before",
        tofile="after",
    )
    print("".join("  " + line for line in diff))

    return True


def write_plain(path, text):
    backup = path.with_suffix(path.suffix + ".bak")
    shutil.copy2(path, backup)
    path.write_text(text, encoding="utf-8")
    print(f"  written (backup: {backup})")


def write_root(path, text):
    handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
    handle.write(text)
    handle.close()
    backup = f"{path}.bak"
    subprocess.run(["sudo", "cp", str(path), backup], check=True)
    subprocess.run(["sudo", "cp", handle.name, str(path)], check=True)
    subprocess.run(["sudo", "chown", "root:wheel", str(path)], check=True)
    subprocess.run(["sudo", "chmod", "644", str(path)], check=True)
    os.unlink(handle.name)
    print(f"  written through sudo (backup: {backup})")


def install_link(source, target, apply_changes, executable=True):
    print(f"\n=== {target}")

    if not source.exists():
        print(f"  source missing: {source}")
        return False

    if target.is_symlink() and target.resolve() == source.resolve():
        print("  already linked to the repo")
        return False

    print(f"  - link {target.name} to {source}")

    if apply_changes:
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() or target.is_symlink():
            target.unlink()
        target.symlink_to(source)
        if executable:
            source.chmod(0o755)
        print("  linked")

    return True


def mirror_reference(path, text, apply_changes):
    print(f"\n=== {path}")

    if path.exists() and path.read_text(encoding="utf-8") == text:
        print("  nothing to change")
        return False

    print(f"  - refresh the reference copy from {MANAGED_SETTINGS}")

    if apply_changes:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        print("  written")

    return True


def process(path, fixer, apply_changes, root=False):
    if not path.exists():
        print(f"\n=== {path}\n  missing, skipped")
        return False

    before = path.read_text(encoding="utf-8")
    data = json.loads(before)
    changes = fixer(data)
    after = dump(data)

    if not report(path, before, after, changes):
        return False

    if apply_changes:
        write_root(path, after) if root else write_plain(path, after)

    return True


def main():
    parser = argparse.ArgumentParser(description="Align the Claude Code settings files this repository owns.")
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    args = parser.parse_args()

    pending = [
        process(USER_SETTINGS, fix_user, args.apply),
        install_link(HOOK_SOURCE, HOOK_TARGET, args.apply),
        install_link(DRIFT_SOURCE, DRIFT_TARGET, args.apply),
        install_link(HERDR_SOURCE, HERDR_TARGET, args.apply, executable=False),
        *(install_link(rules, DETECTION_TARGET / rules.name, args.apply, executable=False) for rules in sorted(DETECTION_SOURCE.glob("*.toml"))),
        process(MANAGED_SETTINGS, fix_managed, args.apply, root=True),
    ]

    if MANAGED_SETTINGS.exists():
        pending.append(mirror_reference(REFERENCE, MANAGED_SETTINGS.read_text(encoding="utf-8"), args.apply))

    print()
    if not any(pending):
        print("Everything already aligned.")
        return 0

    if not args.apply:
        print("Dry run. Re-run with --apply to write; the managed file will ask for sudo.")
        return 0

    print("Done. Restart Claude Code so the managed settings and the hook are reloaded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
