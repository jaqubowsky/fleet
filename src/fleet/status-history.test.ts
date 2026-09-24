import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import handoffOnError from "../../extensions/handoff-on-error.ts";
import statusHistory, { snapshot, versions } from "../../extensions/status-history.ts";

function task(t: TestContext, status?: string): string {
	const dir = mkdtempSync(join(tmpdir(), "status-history-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	if (status !== undefined) writeFileSync(join(dir, "status.md"), status);
	return dir;
}

function env(t: TestContext, values: Record<string, string>) {
	const before = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
	Object.assign(process.env, values);
	t.after(() => {
		for (const [name, value] of Object.entries(before)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	});
}

function runtime() {
	const handlers = new Map<string, (event?: unknown) => void>();
	return { handlers, pi: { on: (event: string, handler: (event?: unknown) => void) => handlers.set(event, handler) } };
}

test("each change to status.md becomes the next numbered version, and an unchanged file adds none", (t) => {
	const dir = task(t, "status: analyzing\n");

	const first = snapshot(dir, new Date(Date.UTC(2026, 8, 23, 20, 40, 13)));
	const repeat = snapshot(dir, new Date(Date.UTC(2026, 8, 23, 20, 41, 0)));
	writeFileSync(join(dir, "status.md"), "status: implementing\n");
	const second = snapshot(dir, new Date(Date.UTC(2026, 8, 23, 20, 43, 58)));

	assert.deepEqual([first, repeat, second], ["001-20260923T204013Z.md", undefined, "002-20260923T204358Z.md"]);
	assert.equal(readFileSync(join(dir, "logs/status/002-20260923T204358Z.md"), "utf8"), "status: implementing\n");
});

test("a task without status.md keeps no version", (t) => {
	const dir = task(t);

	assert.equal(snapshot(dir), undefined);
});

test("versions read in number order past 999, in the reader's local time, and leave other files out", (t) => {
	env(t, { TZ: "Europe/Warsaw" });

	const kept = versions(["1000-20260923T230203Z.md", "notes.md", "999-20260923T215959Z.md", "7-20260923T204013.md"]);

	assert.deepEqual(kept.map((v) => [v.number, v.at]), [[999, "2026-09-23 23:59:59"], [1000, "2026-09-24 01:02:03"]]);
});

test("pi and omp keep a version after every tool, whichever tool wrote the file", (t) => {
	const dir = task(t, "status: new\nattention: none\n");
	env(t, { FLEET_ARTIFACTS: dirname(dir), SANDBOX_NAME: basename(dir) });
	const { handlers, pi } = runtime();
	statusHistory(pi);

	writeFileSync(join(dir, "status.md"), "status: analyzing\nattention: none\n");
	handlers.get("tool_execution_end")?.();
	handlers.get("tool_execution_end")?.();

	const kept = readdirSync(join(dir, "logs/status"));
	assert.equal(kept.length, 1);
	assert.equal(readFileSync(join(dir, "logs/status", kept[0]), "utf8"), "status: analyzing\nattention: none\n");
});

test("an agent that dies on an API error leaves its blocked status as a version", (t) => {
	const dir = task(t, "status: implementing\nattention: none\n");
	mkdirSync(join(dir, "logs/sessions"), { recursive: true });
	env(t, { PI_CODING_AGENT_SESSION_DIR: join(dir, "logs/sessions") });
	const { handlers, pi } = runtime();
	handoffOnError(pi);

	handlers.get("agent_end")?.({ messages: [{ role: "assistant", stopReason: "error", errorMessage: "402 Payment Required" }] });

	const kept = readdirSync(join(dir, "logs/status"));
	assert.equal(kept.length, 1);
	assert.match(readFileSync(join(dir, "logs/status", kept[0]), "utf8"), /^status: blocked\nattention: the agent stopped on an error: 402 Payment Required$/m);
});
