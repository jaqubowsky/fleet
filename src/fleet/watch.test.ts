import assert from "node:assert/strict";
import { test } from "node:test";
import { fleetAgents, wakeLines } from "./watch.ts";

const agents = [
	{ name: "webapp-a", pane_id: "w1:p1", agent_status: "working" },
	{ name: "webapp-b", pane_id: "w1:p2", agent_status: "idle" },
	{ name: "notes", pane_id: "w1:p3", agent_status: "idle" },
];
const sandboxes = [
	{ name: "claude-webapp-a", workspaces: ["/w/webapp"] },
	{ name: "claude-webapp-b", workspaces: ["/w/webapp"] },
];

test("watch follows the harness's containers and nothing else in herdr", () => {
	assert.deepEqual(fleetAgents(agents, sandboxes, []).map((a) => a.name), ["webapp-a", "webapp-b"]);
	assert.deepEqual(fleetAgents(agents, sandboxes, ["claude-webapp-b"]).map((a) => a.name), ["webapp-b"]);
});

test("a wake names the agent and its change before the status.md projection", () => {
	assert.equal(wakeLines("webapp-a", "working -> idle", "status: ready-for-host"), "[fleet] webapp-a: working -> idle\nstatus: ready-for-host");
});
