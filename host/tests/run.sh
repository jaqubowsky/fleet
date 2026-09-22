#!/usr/bin/env bash
set -uo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pi_root="$(dirname "$(readlink -f "$(command -v pi)")")/../.."
tmp="$(mktemp -d "${TMPDIR:-/tmp}/skills.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
out="$tmp"
FLEET_HARNESS=pi node "$dir/../../src/fleet/cli.ts" render --seat container --out "$out/c" >/dev/null && mkdir -p "$out/all" && cp -R "$out/c/home/skills/." "$out/all/" && FLEET_HARNESS=pi node "$dir/../../src/fleet/cli.ts" render --out "$out/h" >/dev/null && cp -R "$out/h/skills/host/." "$out/all/" && rm -rf "$out/c" "$out/h" && out="$out/all"

node --input-type=module -e '
const { loadSkillsFromDir } = await import(process.argv[1]);
const { skills, diagnostics } = loadSkillsFromDir({ dir: process.argv[2], source: "path" });
for (const d of diagnostics) process.stderr.write(`FAIL  skill  ${d.path}: ${d.message}\n`);
process.stdout.write(`skills: ${skills.length} loaded, ${diagnostics.length} failed\n`);
process.exitCode = diagnostics.length === 0 ? 0 : 1;
' "$pi_root/dist/index.js" "$out"; skills=$?

node "$dir/extension_syntax_test.mjs"; syntax=$?

node "$dir/session_handoff_test.mjs" "$pi_root/dist/index.js"; handoff=$?

[ "$skills" -eq 0 ] && [ "$syntax" -eq 0 ] && [ "$handoff" -eq 0 ]
