import assert from "node:assert/strict";
import { test } from "node:test";
import register from "../../agent/extensions/guard.ts";

type Verdict = { block: boolean; reason: string } | undefined;

function handler() {
	let captured: ((event: { toolName: string; input?: Record<string, unknown> }) => unknown) | undefined;
	register({ on: (_event, fn) => { captured = fn; } });
	assert.ok(captured, "the extension registered no tool_call handler");

	return captured as (event: { toolName: string; input?: Record<string, unknown> }) => Verdict;
}

test("the extension blocks what the policy denies and stays out of the way otherwise", () => {
	const guard = handler();

	assert.equal(guard({ toolName: "bash", input: { command: "ls -la" } }), undefined);
	assert.equal(guard({ toolName: "fleet_watch", input: { agents: "" } }), undefined);

	const denied = guard({ toolName: "bash", input: { command: "git push --force origin main" } });
	assert.equal(denied?.block, true);
	assert.match(denied?.reason ?? "", /force, delete or mirror push/);

	const unknown = guard({ toolName: "telepathy", input: { thought: "x" } });
	assert.equal(unknown?.block, true);
	assert.match(unknown?.reason ?? "", /Unknown tool policy: telepathy/);
});

test("a denied command comes back blocked with the reason the policy gave", () => {
	const guard = handler();

	const denied = guard({ toolName: "bash", input: { command: "gh pr create --title x" } });

	assert.equal(denied?.block, true);
	assert.match(denied?.reason ?? "", /push by another name/);
});
