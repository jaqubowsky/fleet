import assert from "node:assert/strict";
import { test } from "node:test";
import { agentFor, fleetSandboxes, formatRows, parseCheckout } from "./status.ts";

test("only pi- sandboxes belong to the fleet", () => {
	const all = { sandboxes: [{ name: "claude-x", status: "running", workspaces: [] }, { name: "pi-webapp-a", status: "stopped", workspaces: ["/r"] }] };
	assert.deepEqual(fleetSandboxes(all).map((s) => s.name), ["pi-webapp-a"]);
});

test("checkout probe output parses branch, dirty count and head", () => {
	assert.deepEqual(parseCheckout("web-1\t3\tabc"), { branch: "web-1", dirty: 3, head: "abc" });
	assert.deepEqual(parseCheckout(""), { branch: "", dirty: 0, head: "" });
});

test("agent lookup by name", () => {
	assert.equal(agentFor([{ pane_id: "w1:p1", name: "a", agent_status: "idle" }], "a")?.agent_status, "idle");
	assert.equal(agentFor([], "a"), undefined);
});

test("rows render aligned with dirty count only when dirty", () => {
	const out = formatRows([
		{ sandbox: "pi-a", status: "running", agent: "idle", branch: "main", dirty: 0 },
		{ sandbox: "pi-long-name", status: "running", agent: "gone", branch: "x", dirty: 2 },
	]);
	assert.equal(out, "pi-a          running  idle     main\npi-long-name  running  gone     x  2 uncommitted");
	assert.equal(formatRows([]), "no fleet containers");
});

test("a garbled dirty count reads as zero rather than NaN", () => {
	assert.equal(parseCheckout("main\tabc\tdef").dirty, 0);
});
