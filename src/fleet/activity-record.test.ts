import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import activity from "../../extensions/activity.ts";

function task(t: TestContext): string {
	const dir = mkdtempSync(join(tmpdir(), "activity-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
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

test("pi appends one activity line per finished tool: time, tool, ok, agent", (t) => {
	const dir = task(t);
	env(t, { FLEET_ARTIFACTS: dirname(dir), SANDBOX_NAME: basename(dir) });
	const { handlers, pi } = runtime();
	activity(pi);

	handlers.get("tool_execution_end")?.({ toolName: "bash", isError: false });
	handlers.get("tool_execution_end")?.({ toolName: "edit", isError: true });

	const lines = readFileSync(join(dir, "logs/activity.jsonl"), "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
	assert.deepEqual(lines.map(({ at, ...rest }) => rest), [
		{ tool: "bash", ok: true, agent: "main" },
		{ tool: "edit", ok: false, agent: "main" },
	]);
	assert.ok(lines.every((line) => !Number.isNaN(Date.parse(line.at))));
	assert.equal(existsSync(join(dir, "status.md")), false);
	assert.equal(existsSync(join(dir, "logs/status.jsonl")), false);
});
