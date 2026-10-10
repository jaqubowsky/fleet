import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test, type TestContext } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function container(t: TestContext) {
	const root = mkdtempSync(join(tmpdir(), "claude-hooks-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const task = join(root, "claude-a");
	mkdirSync(task);
	const script = join(import.meta.dirname, "../../claude/hooks/container.ts");
	const hook = (event: string, input = "{}") => execFileSync(process.execPath, [script, event], { input, env: { ...process.env, FLEET_ARTIFACTS: root, SANDBOX_NAME: "claude-a" } });
	return { task, hook };
}

test("a finished and a failed tool call each append one activity line, a sub-agent's under its own id", (t) => {
	const { task, hook } = container(t);

	hook("post-tool-use", JSON.stringify({ tool_name: "Bash" }));
	hook("post-tool-use-failure", JSON.stringify({ tool_name: "Read", agent_id: "a1" }));

	const lines = readFileSync(join(task, "logs/activity.jsonl"), "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
	assert.deepEqual(lines.map(({ at, ...rest }) => rest), [
		{ tool: "Bash", ok: true, agent: "main" },
		{ tool: "Read", ok: false, agent: "a1" },
	]);
	assert.ok(lines.every((line) => !Number.isNaN(Date.parse(line.at))));
});

test("the hook writes no task state beside the activity log", (t) => {
	const { task, hook } = container(t);

	hook("post-tool-use", JSON.stringify({ tool_name: "Bash" }));

	assert.deepEqual(readdirSync(task), ["logs"]);
	assert.deepEqual(readdirSync(join(task, "logs")), ["activity.jsonl"]);
	assert.equal(existsSync(join(task, "status.md")), false);
});
