import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "../..");
const STUBS = {
	claude: "echo 1.0.0",
	pi: "echo 1.0.0",
	docker: "exit 0",
	sbx: `case "$1" in template) echo '[{"repository":"docker.io/library/my-claude","tag":"v1"},{"repository":"docker.io/library/my-pi","tag":"v1"}]' ;; *) echo '[]' ;; esac`,
};

function machine(t, agents) {
	const dir = mkdtempSync(join(tmpdir(), "sync-test-"));
	const home = join(dir, "home");
	const bin = join(dir, "bin");
	spawnSync("mkdir", ["-p", home, bin]);
	symlinkSync(process.execPath, join(bin, "node"));
	for (const tool of ["jq", "python3"]) {
		const found = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
		if (found) symlinkSync(found, join(bin, tool));
	}
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
	return { home, dir, sync };
}

function claudeMac(t) {
	const mac = machine(t, ["claude", "docker", "sbx"]);
	for (const path of [".fleet/config/git", ".config/herdr-app/layouts"])
		mkdirSync(join(mac.home, path), { recursive: true });
	return mac;
}

function archives(home) {
	const dir = join(home, ".fleet/backups");
	try {
		return readdirSync(dir).map((name) => join(dir, name));
	} catch {
		return [];
	}
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

test("a pi-only Mac sets up pi and the Herdr app layout and mods without claude's pieces", (t) => {
	const mac = machine(t, ["pi"]);

	const { status, out } = mac.sync();

	assert.equal(status, 0, out);
	assert.match(out, /== pi: host seat/);
	assert.doesNotMatch(out, /== claude/);
	assert.doesNotMatch(out, /statusline\.mjs/);
	assert.match(out, /\.config\/herdr-app\/layouts\/fleet\.json/);
	assert.match(out, /\.config\/herdr-app\/mods\/fleet-agents/);
	assert.match(out, /cp \S+\/host\/herdr-app\/icons\/added\.svg \S+\/\.config\/herdr-app\/fleet-icons\/added\.svg/);
	assert.match(out, /\.config\/herdr-core\/config\.toml/);
	assert.match(section(out, "set up by hand"), /skipped claude: no claude on PATH/);
});

test("a Mac with neither agent stops before it changes anything", (t) => {
	const mac = machine(t, []);

	const { status, out } = mac.sync("--apply");

	assert.equal(status, 1, out);
	assert.match(out, /neither claude nor pi is on PATH/i);
	assert.doesNotMatch(out, /== commands/);
});

test("a dry run names the archive --apply would write", (t) => {
	const mac = claudeMac(t);

	const { status, out } = mac.sync();

	assert.equal(status, 0, out);
	assert.match(out, /~\/\.fleet\/backups\/<UTC timestamp>\.tar\.gz/);
	assert.deepEqual(archives(mac.home), []);
});

test("--apply first packs the files it replaces into one archive", (t) => {
	const mac = claudeMac(t);
	const settings = join(mac.home, ".claude/settings.json");
	const layout = join(mac.home, ".config/herdr-app/layouts/fleet.json");
	mkdirSync(join(mac.home, ".claude"), { recursive: true });
	writeFileSync(settings, '{"language": "Polish"}\n');
	writeFileSync(layout, '{"id": "mine"}\n');

	const { status, out } = mac.sync("--apply");

	assert.equal(status, 0, out);
	const made = archives(mac.home);
	assert.equal(made.length, 1, out);
	assert.match(out, new RegExp(`tar -xzf ${made[0].replace(mac.home, "~")} -C ~`));
	const restored = join(mac.dir, "restored");
	mkdirSync(restored);
	assert.equal(spawnSync("tar", ["-xzf", made[0], "-C", restored]).status, 0);
	assert.equal(readFileSync(join(restored, ".claude/settings.json"), "utf8"), '{"language": "Polish"}\n');
	assert.equal(readFileSync(join(restored, ".config/herdr-app/layouts/fleet.json"), "utf8"), '{"id": "mine"}\n');
	assert.notEqual(readFileSync(settings, "utf8"), '{"language": "Polish"}\n');
	assert.deepEqual(readdirSync(join(mac.home, ".config/herdr-app/layouts")).filter((name) => name.endsWith(".bak")), []);
});

test("--apply records the built image under ~/.fleet", (t) => {
	const mac = claudeMac(t);

	const { status, out } = mac.sync("--apply");

	assert.equal(status, 0, out);
	assert.deepEqual(readdirSync(join(mac.home, ".fleet/state/images")), ["claude"]);
});

test("--apply with nothing to change writes no archive", (t) => {
	const mac = claudeMac(t);
	mac.sync("--apply");
	rmSync(join(mac.home, ".fleet/backups"), { recursive: true });

	const { status, out } = mac.sync("--apply");

	assert.equal(status, 0, out);
	assert.match(out, /In sync: nothing to change\./);
	assert.deepEqual(archives(mac.home), []);
});

test("--apply removes the empty task directory of a sandbox that never started", (t) => {
	const mac = claudeMac(t);
	const task = join(mac.home, ".fleet/tasks/webapp/pi-webapp-a");
	mkdirSync(task, { recursive: true });
	writeFileSync(join(task, "status.md"), "status: new\n");

	const { status, out } = mac.sync("--apply");

	assert.equal(status, 0, out);
	assert.deepEqual(readdirSync(join(mac.home, ".fleet/tasks/webapp")), []);
});

test("--apply relinks a dangling fleet link instead of removing it", (t) => {
	const mac = claudeMac(t);
	const fleet = join(mac.home, ".local/bin/fleet");
	mkdirSync(join(mac.home, ".local/bin"), { recursive: true });
	symlinkSync(join(mac.dir, "moved-clone/bin/fleet"), fleet);

	const { status, out } = mac.sync("--apply");

	assert.equal(status, 0, out);
	assert.equal(readlinkSync(fleet), join(root, "bin/fleet"));
});

test("--apply archives a person's own link in a directory the render owns", (t) => {
	const mac = claudeMac(t);
	mkdirSync(join(mac.home, ".claude/skills"), { recursive: true });
	symlinkSync(join(mac.dir, "my-skill"), join(mac.home, ".claude/skills/mine"));

	const { status, out } = mac.sync("--apply");

	assert.equal(status, 0, out);
	const listing = spawnSync("tar", ["-tvzf", archives(mac.home)[0]], { encoding: "utf8" }).stdout;
	assert.match(listing, /\.claude\/skills\/mine -> /);
});
