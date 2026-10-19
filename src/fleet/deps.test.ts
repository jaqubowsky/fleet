import assert from "node:assert/strict";
import { test } from "node:test";
import { installScript } from "./deps.ts";

test("install script picks the frozen install per lockfile and invents no env of its own", () => {
	assert.match(installScript(), /pnpm install --frozen-lockfile/);
	assert.match(installScript(), /npm ci/);
	assert.match(installScript(), /yarn install --immutable/);
	assert.match(installScript(), /yarn install --frozen-lockfile/);
	assert.doesNotMatch(installScript(), /\\\$/);
	assert.doesNotMatch(installScript(), /\.example/);
});

test("install script runs a declared generator before it reports ready", () => {
	const generate = installScript().indexOf("prisma:generate");
	const ready = installScript().indexOf("deps-end: ready");

	assert.ok(generate !== -1, "the script runs no code generation");
	assert.ok(generate < ready, "code generation runs after the script reports ready");
	assert.match(installScript(), /npm run/);
	assert.match(installScript(), /codegen/);
});


async function run(files: Record<string, string>, tools: Record<string, string> = {}, setup?: string, before?: (workspace: string) => void) {
	const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, chmodSync } =
		await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { execFileSync } = await import("node:child_process");
	const workspace = mkdtempSync(join(tmpdir(), "deps-"));
	const bin = join(workspace, ".bin");
	mkdirSync(bin);
	const trace = join(workspace, "fnm-calls");
	writeFileSync(
		join(bin, "fnm"),
		`#!/bin/sh\necho "$@" >> ${trace}\n[ "$1" = env ] && echo ":"\nexit 0\n`,
	);
	chmodSync(join(bin, "fnm"), 0o755);
	for (const [name, body] of Object.entries(tools)) {
		writeFileSync(join(bin, name), body);
		chmodSync(join(bin, name), 0o755);
	}
	for (const [name, body] of Object.entries(files))
		writeFileSync(join(workspace, name), body);
	before?.(workspace);
	let log: string;
	try {
		log = execFileSync("bash", ["-c", `exec 2>&1\n${installScript(setup)}`], {
			env: {
				...process.env,
				WORKSPACE_DIR: workspace,
				PATH: `${bin}:${process.env.PATH}`,
			},
			encoding: "utf8",
		});
	} catch (error) {
		log = String((error as { stdout?: string }).stdout ?? "");
	}
	let calls = "";
	try {
		calls = readFileSync(trace, "utf8");
	} catch {
		calls = "";
	}
	return { log, calls };
}

test("a repository that declares no node version still installs", async () => {
	const { log, calls } = await run({});

	assert.match(log, /deps-end: ready/);
	assert.equal(calls, "", "fnm is not asked for a version nothing declares");
	assert.match(log.trim().split("\n").at(-1)!, /node v\d+/);
});

test("a repository that declares a node version goes through fnm", async () => {
	const { log, calls } = await run({ ".nvmrc": "24.20.0\n" });

	assert.match(log, /deps-end: ready/);
	assert.match(calls, /use --install-if-missing/);
});

test("a repository whose engines name only a range installs on the image's node", async () => {
	const { log, calls } = await run({ "package.json": '{"engines":{"node":">=20"}}' });

	assert.match(log, /deps-end: ready/);
	assert.equal(calls, "", "fnm is not asked for a range only engines names");
});

test("a repository that pins node only through engines installs on that node and makes it every shell's default", async () => {
	const { log, calls } = await run({ "package.json": '{"engines":{"node":"22.22"}}' });

	assert.match(log, /deps-end: ready/);
	assert.match(calls, /^use --install-if-missing 22\.22$/m);
	assert.match(calls, /^default 22\.22$/m);
});

test("an install that fails names its root and exit instead of leaving the log mid-run", async () => {
	const { log } = await run(
		{ "package.json": "{}", "package-lock.json": "{}" },
		{ npm: "#!/bin/sh\necho registry down\nexit 3\n" },
	);

	assert.match(log, /registry down/);
	assert.match(log.trim().split("\n").at(-1)!, /^deps-end: failed in \. with exit 3$/);
	assert.doesNotMatch(log, /deps-end: ready/);
});

test("a setup command runs after the install and logs before ready", async () => {
	const { log } = await run({}, {}, "echo browsers installed");

	assert.match(log, /deps: running setup\nbrowsers installed\ndeps-end: ready/);
});

test("an install under way says what it is doing, so its line never reads as an end state", async () => {
	const { log } = await run(
		{ "package.json": "{}", "package-lock.json": "{}" },
		{ npm: "#!/bin/sh\nexit 0\n" },
	);

	assert.match(log, /^deps: installing in \.$/m);
});

test("a directory the lockfile search cannot read leaves no error in the log", async () => {
	const { chmodSync, mkdirSync } = await import("node:fs");
	const { join } = await import("node:path");
	let locked = "";

	const { log } = await run({}, {}, undefined, (workspace) => {
		locked = join(workspace, "locked");
		mkdirSync(locked);
		chmodSync(locked, 0o000);
	});
	chmodSync(locked, 0o755);

	assert.doesNotMatch(log, /Permission denied/);
	assert.match(log, /deps-end: ready/);
});

test("a failing setup command ends the log as a failed install", async () => {
	const { log } = await run({}, {}, "echo no browsers\nexit 4");

	assert.match(log.trim().split("\n").at(-1)!, /^deps-end: failed in setup with exit 4$/);
	assert.doesNotMatch(log, /deps-end: ready/);
});

test("a setup line that fails before the last one still ends the log as a failed install", async () => {
	const { log } = await run({}, {}, "false\necho ok");

	assert.match(log.trim().split("\n").at(-1)!, /^deps-end: failed in setup with exit 1$/);
	assert.doesNotMatch(log, /deps-end: ready/);
});

test("an npm install waits longer and retries more than npm's defaults on a slow registry", async () => {
	const { log } = await run(
		{ "package.json": "{}", "package-lock.json": "{}" },
		{ npm: '#!/bin/sh\necho "args: $*"\nexit 9\n' },
	);

	const args = log.match(/^args: (.*)$/m)?.[1] ?? "";
	assert.ok(Number(args.match(/--fetch-timeout=(\d+)/)?.[1]) > 300000, args);
	assert.ok(Number(args.match(/--fetch-retries=(\d+)/)?.[1]) > 2, args);
});

test("a pnpm that refuses fetch flags, as pnpm 12 does, installs with longer timeouts and more retries", async () => {
	const { readFileSync } = await import("node:fs");
	let workspace = "";
	const { log } = await run(
		{ "package.json": "{}", "pnpm-lock.yaml": "{}" },
		{
			pnpm: [
				"#!/bin/sh",
				'for arg; do case "$arg" in --fetch-*) echo "error: unexpected argument \'$arg\' found"; exit 2;; esac; done',
				'echo "timeout=$PNPM_CONFIG_FETCH_TIMEOUT retries=$PNPM_CONFIG_FETCH_RETRIES" > fetch-settings',
			].join("\n"),
		},
		undefined,
		(dir) => (workspace = dir),
	);
	const settings = readFileSync(`${workspace}/fetch-settings`, "utf8");

	assert.match(log, /deps-end: ready/);
	assert.ok(Number(settings.match(/timeout=(\d+)/)?.[1]) > 300000, settings);
	assert.ok(Number(settings.match(/retries=(\d+)/)?.[1]) > 2, settings);
});

test("a yarn install keeps yarn's own fetch settings", async () => {
	const { log } = await run(
		{ "package.json": "{}", "yarn.lock": "" },
		{ yarn: '#!/bin/sh\necho "args: $*"\nexit 9\n' },
	);

	assert.match(log, /^args: install --frozen-lockfile$/m);
});

const endings: [string, Parameters<typeof run>, RegExp][] = [
	["ready", [{}], /^deps-end: ready on node v\d+/],
	["failed in a root", [{ "package.json": "{}", "package-lock.json": "{}" }, { npm: "#!/bin/sh\nexit 3\n" }], /^deps-end: failed in \. with exit 3$/],
	["failed in setup", [{}, {}, "exit 4"], /^deps-end: failed in setup with exit 4$/],
	["stalled", [{ "package.json": "{}", "package-lock.json": "{}" }, { npm: "#!/bin/sh\nexit 124\n" }], /^deps-end: stalled past 20 minutes in \.$/],
];

for (const [ending, args, last] of endings) {
	test(`an install that ends ${ending} says so on the one line that carries the end prefix`, async () => {
		const { log } = await run(...args);

		const lines = log.trim().split("\n");
		assert.match(lines.at(-1)!, last);
		assert.deepEqual(lines.slice(0, -1).filter((line) => line.includes("deps-end:")), []);
	});
}
