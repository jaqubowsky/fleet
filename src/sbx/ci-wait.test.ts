import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = new URL("../../sbx/container/ci-wait.sh", import.meta.url)
	.pathname;
const sha = "a".repeat(40);

function ciWait(
	gh: { head?: string; pending: string; total: string; state: string },
	...args: string[]
) {
	const bin = mkdtempSync(join(tmpdir(), "ci-wait-"));
	writeFileSync(
		join(bin, "gh"),
		`#!/usr/bin/env bash
case "$*" in
  *headRefOid*) echo '${gh.head ?? sha}' ;;
  *"run list"*"select"*) echo '${gh.pending}' ;;
  *"run list"*"--jq length"*) echo '${gh.total}' ;;
  *"run list"*) echo '[]' ;;
  *"--jq .state"*) echo '${gh.state}' ;;
  *) echo '{}' ;;
esac
`,
	);
	chmodSync(join(bin, "gh"), 0o755);
	const run = spawnSync("bash", [script, "o/r", "7", ...args], {
		encoding: "utf8",
		env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CI_WAIT_INTERVAL: "0" },
	});
	return { status: run.status, out: run.stdout + run.stderr };
}

test("settled runs end the wait green", () => {
	const run = ciWait({ pending: "0", total: "2", state: "success" });

	assert.equal(run.status, 0);
	assert.match(run.out, /read 1\/20: 0 of 2 runs pending, status success/);
});

test("runs still pending after the last read are a finding", () => {
	const run = ciWait({ pending: "1", total: "2", state: "pending" }, "3");

	assert.equal(run.status, 1);
	assert.match(run.out, /still pending after 3 reads/);
});

test("no runs registered yet keeps waiting", () => {
	const run = ciWait({ pending: "0", total: "0", state: "success" }, "2");

	assert.equal(run.status, 1);
});

test("an error body instead of a count stops the wait", () => {
	const run = ciWait({ pending: '{"message":"Bad credentials"}', total: "2", state: "success" });

	assert.equal(run.status, 2);
	assert.match(run.out, /read failed, stop waiting/);
});

test("a short head sha stops before the first read", () => {
	const run = ciWait({ head: "abc1234", pending: "0", total: "2", state: "success" });

	assert.equal(run.status, 2);
	assert.match(run.out, /head read failed/);
});
