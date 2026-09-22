import assert from "node:assert/strict";
import { test } from "node:test";
import { installScript } from "./deps.ts";

test("install script picks the frozen install per lockfile and invents no env of its own", () => {
	assert.match(installScript, /pnpm install --frozen-lockfile/);
	assert.match(installScript, /npm ci/);
	assert.match(installScript, /yarn install --immutable/);
	assert.match(installScript, /yarn install --frozen-lockfile/);
	assert.doesNotMatch(installScript, /\\\$/);
	assert.doesNotMatch(installScript, /\.example/);
});

test("install script runs a declared generator before it reports ready", () => {
	const generate = installScript.indexOf("prisma:generate");
	const ready = installScript.indexOf("deps: ready");

	assert.ok(generate !== -1, "the script runs no code generation");
	assert.ok(generate < ready, "code generation runs after the script reports ready");
	assert.match(installScript, /npm run/);
	assert.match(installScript, /codegen/);
});


async function run(files: Record<string, string>) {
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
	for (const [name, body] of Object.entries(files))
		writeFileSync(join(workspace, name), body);
	const log = execFileSync("bash", ["-c", installScript], {
		env: {
			...process.env,
			WORKSPACE_DIR: workspace,
			PATH: `${bin}:${process.env.PATH}`,
		},
		encoding: "utf8",
	});
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

	assert.match(log, /deps: ready/);
	assert.equal(calls, "", "fnm is not asked for a version nothing declares");
	assert.match(log.trim().split("\n").at(-1)!, /node v\d+/);
});

test("a repository that declares a node version goes through fnm", async () => {
	const { log, calls } = await run({ ".nvmrc": "24.20.0\n" });

	assert.match(log, /deps: ready/);
	assert.match(calls, /use --install-if-missing/);
});
