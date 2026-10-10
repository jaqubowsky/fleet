#!/usr/bin/env python3
import argparse
import contextlib
import difflib
import io
import json
import sys
from pathlib import Path

HOME = Path.home()
REPO = Path(__file__).resolve().parents[2]
USER_SETTINGS = HOME / ".claude" / "settings.json"
HOST_SEAT = REPO / "claude" / "profiles" / "models.json"
HOST_SETTINGS = REPO / "claude" / "profiles" / "host.json"
COMPACTION = REPO / "src" / "compaction.json"
HOOK_SOURCE = REPO / "claude" / "hooks" / "guard.sh"
HOOK_TARGET = HOME / ".claude" / "hooks" / "guard.sh"
DRIFT_SOURCE = REPO / "claude" / "hooks" / "plugin-drift.sh"
DRIFT_TARGET = HOME / ".claude" / "hooks" / "plugin-drift.sh"

LSP_PLUGIN = "typescript-lsp@claude-plugins-official"


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

    before = dump(data)
    desired = desired_host()
    hooks = desired.pop("hooks", {})
    merge(data, desired)
    merge_hooks(data.setdefault("hooks", {}), hooks)
    if dump(data) != before:
        changes.append(f"brought in line with {HOST_SETTINGS.relative_to(REPO)}")

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
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    print("  written")


def install_link(source, target, apply_changes):
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
        target.unlink(missing_ok=True)
        target.symlink_to(source)
        source.chmod(0o755)
        print("  linked")

    return True


def merge(base, over):
    for key, value in over.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            merge(base[key], value)
        else:
            base[key] = value

    return base


def merge_hooks(base, over):
    for event, entries in over.items():
        owned = {hook.get("command") for entry in entries for hook in entry.get("hooks", [])}
        kept = [entry for entry in base.get(event, []) if not owned & {hook.get("command") for hook in entry.get("hooks", [])}]
        base[event] = kept + entries

    return base


def expand(value):
    if isinstance(value, dict):
        return {key: expand(item) for key, item in value.items()}
    if isinstance(value, list):
        return [expand(item) for item in value]
    if isinstance(value, str):
        return value.replace("$HOME", str(HOME)).replace("$HARNESS", str(REPO)).replace("{{compaction.tokens}}", str(load(COMPACTION)["tokens"]))

    return value


def desired_host():
    return expand(load(HOST_SETTINGS))


def process(path, fixer, apply_changes):
    before = path.read_text(encoding="utf-8") if path.exists() else ""
    data = json.loads(before or "{}")
    changes = fixer(data)
    after = dump(data)

    if not report(path, before, after, changes):
        return False

    if apply_changes:
        write_plain(path, after)

    return True


def main():
    parser = argparse.ArgumentParser(description="Align the Claude Code user settings and hooks with this repository.")
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    parser.add_argument("--targets", action="store_true", help="print only the paths --apply would change")
    args = parser.parse_args()

    with contextlib.redirect_stdout(io.StringIO() if args.targets else sys.stdout):
        pending = {
            USER_SETTINGS: process(USER_SETTINGS, fix_user, args.apply),
            HOOK_TARGET: install_link(HOOK_SOURCE, HOOK_TARGET, args.apply),
            DRIFT_TARGET: install_link(DRIFT_SOURCE, DRIFT_TARGET, args.apply),
        }

    if args.targets:
        for target, changed in pending.items():
            if changed:
                print(target)
        return 0

    print()
    if not any(pending.values()):
        print("Everything already aligned.")
        return 0

    if not args.apply:
        print("Dry run. Re-run with --apply to write.")
        return 0

    print("Done. Restart Claude Code so the settings and the hook are reloaded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
