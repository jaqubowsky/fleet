import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "../..");
const STUBS = {
	claude: "echo 1.0.0",
	pi: "echo 1.0.0",
};

function machine(t, agents) {
	const dir = mkdtempSync(join(tmpdir(), "sync-test-"));
	const home = join(dir, "home");
	const bin = join(dir, "bin");
	spawnSync("mkdir", ["-p", home, bin]);
	symlinkSync(process.execPath, join(bin, "node"));
	for (const agent of agents) {
		writeFileSync(join(bin, agent), `#!/bin/sh\n${STUBS[agent]}\n`);
		chmodSync(join(bin, agent), 0o755);
	}
	const sync = (...args) => {
		const result = spawnSync(join(root, "sync.sh"), args, {
			encoding: "utf8",
			env: { HOME: home, PATH: `${bin}:/usr/bin:/bin`, TMPDIR: dir },
		});
		return { status: result.status, out: result.stdout + result.stderr };
	};
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return { home, sync };
}

function section(out, heading) {
	return out.split("\n== ").find((part) => part.startsWith(heading)) ?? "";
}

test("a claude-only Mac sets up claude and names pi as skipped", (t) => {
	const mac = machine(t, ["claude"]);

	const { status, out } = mac.sync();

	assert.equal(status, 0, out);
	assert.match(out, /== claude: host seat/);
	assert.match(out, /== claude settings and hooks/);
	assert.doesNotMatch(out, /== pi:/);
	assert.match(section(out, "set up by hand"), /skipped pi: no pi on PATH/);
	assert.doesNotMatch(section(out, "set up by hand"), /skipped claude/);
});

test("a pi-only Mac sets up pi and herdr without claude's pieces", (t) => {
	const mac = machine(t, ["pi"]);

	const { status, out } = mac.sync();

	assert.equal(status, 0, out);
	assert.match(out, /== pi: host seat/);
	assert.doesNotMatch(out, /== claude/);
	assert.doesNotMatch(out, /statusline\.mjs/);
	assert.match(out, /\.config\/herdr\/config\.toml/);
	assert.match(section(out, "set up by hand"), /skipped claude: no claude on PATH/);
});

test("a Mac with neither agent stops before it changes anything", (t) => {
	const mac = machine(t, []);

	const { status, out } = mac.sync("--apply");

	assert.equal(status, 1, out);
	assert.match(out, /neither claude nor pi is on PATH/i);
	assert.doesNotMatch(out, /== commands/);
});
