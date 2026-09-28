import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import handoffOnError from "../../extensions/handoff-on-error.ts";
import statusHistory, { changes, snapshot } from "../../extensions/status-history.ts";

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

const kept = (dir: string) => changes(readFileSync(join(dir, "logs/status.jsonl"), "utf8"));

test("each change to status.md adds one line with only the Log lines it added and removed, and an unchanged file adds none", (t) => {
	const dir = task(t, "status: analyzing\nattention: none\n\n## Log\n- analysis started; analysis.md\n");

	snapshot(dir, new Date(Date.UTC(2026, 8, 23, 20, 40, 13)));
	const repeat = snapshot(dir, new Date(Date.UTC(2026, 8, 23, 20, 41, 0)));
	writeFileSync(join(dir, "status.md"), "status: implementing\nattention: none\n\n## Log\n- analysis written; analysis.md\n- ticket 01 claimed; issues/01.md\n");
	snapshot(dir, new Date(Date.UTC(2026, 8, 23, 20, 43, 58)));
	const replayed = snapshot(dir, new Date(Date.UTC(2026, 8, 23, 20, 44, 30)));

	assert.equal(repeat, undefined);
	assert.equal(replayed, undefined);
	assert.deepEqual(kept(dir), [
		{ at: "2026-09-23T20:40:13.000Z", status: "analyzing", attention: "none", added: ["- analysis started; analysis.md"], removed: [] },
		{ at: "2026-09-23T20:43:58.000Z", status: "implementing", attention: "none", added: ["- analysis written; analysis.md", "- ticket 01 claimed; issues/01.md"], removed: ["- analysis started; analysis.md"] },
	]);
});

test("a task without status.md keeps no line", (t) => {
	const dir = task(t);

	assert.equal(snapshot(dir), undefined);
});

test("pi and omp keep a change after every tool, whichever tool wrote the file", (t) => {
	const dir = task(t, "status: new\nattention: none\n");
	env(t, { FLEET_ARTIFACTS: dirname(dir), SANDBOX_NAME: basename(dir) });
	const { handlers, pi } = runtime();
	statusHistory(pi);

	writeFileSync(join(dir, "status.md"), "status: analyzing\nattention: none\n");
	handlers.get("tool_execution_end")?.({ toolName: "write", isError: false });
	handlers.get("tool_execution_end")?.({ toolName: "write", isError: false });

	assert.deepEqual(kept(dir).map(({ at, ...rest }) => rest), [{ status: "analyzing", attention: "none", added: [], removed: [] }]);
});

test("pi and omp append one activity line per finished tool: time, tool, ok, agent", (t) => {
	const dir = task(t, "status: new\nattention: none\n");
	env(t, { FLEET_ARTIFACTS: dirname(dir), SANDBOX_NAME: basename(dir) });
	const { handlers, pi } = runtime();
	statusHistory(pi);

	handlers.get("tool_execution_end")?.({ toolName: "bash", isError: false });
	handlers.get("tool_execution_end")?.({ toolName: "edit", isError: true });

	const lines = readFileSync(join(dir, "logs/activity.jsonl"), "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
	assert.deepEqual(lines.map(({ at, ...rest }) => rest), [
		{ tool: "bash", ok: true, agent: "main" },
		{ tool: "edit", ok: false, agent: "main" },
	]);
	assert.ok(lines.every((line) => !Number.isNaN(Date.parse(line.at))));
});

test("an agent that dies on an API error leaves its blocked status as a change", (t) => {
	const dir = task(t, "status: implementing\nattention: none\n");
	mkdirSync(join(dir, "logs/sessions"), { recursive: true });
	env(t, { PI_CODING_AGENT_SESSION_DIR: join(dir, "logs/sessions") });
	const { handlers, pi } = runtime();
	handoffOnError(pi);

	handlers.get("agent_end")?.({ messages: [{ role: "assistant", stopReason: "error", errorMessage: "402 Payment Required" }] });

	assert.deepEqual(kept(dir).map(({ status, attention }) => [status, attention]), [["blocked", "the agent stopped on an error: 402 Payment Required"]]);
});
