import assert from "node:assert/strict";
import { test } from "node:test";
import {
	taskDirOf,
	pickAgents,
	shouldWake,
	transition,
} from "../../agent/extensions/fleet-monitor.ts";

test("watch everyone but self, or only the named agents", () => {
	const agents = [
		{ pane_id: "w:p1", name: "me" },
		{ pane_id: "w:p2", name: "a" },
		{ pane_id: "w:p3" },
	];
	assert.deepEqual(
		pickAgents(agents, [], "w:p1").map((a) => a.pane_id),
		["w:p2", "w:p3"],
	);
	assert.deepEqual(
		pickAgents(agents, ["a", "w:p3"], "w:p1").map((a) => a.pane_id),
		["w:p2", "w:p3"],
	);
	assert.deepEqual(pickAgents(agents, ["me"], "w:p1"), []);
});

test("a sandbox name picks the agent herdr named after it", () => {
	const agents = [
		{ pane_id: "w:p1", name: "webapp-bug-ledger-repo-126faba" },
		{ pane_id: "w:p2", name: "webapp-web-1705-no-dat-4405762" },
	];

	const picked = pickAgents(agents, ["pi-webapp-bug-ledger-repost-status-bar"], "w:p0");

	assert.deepEqual(picked.map((a) => a.pane_id), ["w:p1"]);
});

test("a transition line only when the status changed", () => {
	assert.equal(transition("working", "idle"), "working -> idle");
	assert.equal(transition(undefined, "idle"), "? -> idle");
	assert.equal(transition("idle", "idle"), undefined);
});

test("wake on settling, never on going back to work", () => {
	assert.equal(shouldWake("working", "done"), true);
	assert.equal(shouldWake("done", "idle"), false);
	assert.equal(shouldWake("idle", "done"), false);
	assert.equal(shouldWake("idle", "working"), false);
	assert.equal(shouldWake(undefined, "idle"), true);
	assert.equal(shouldWake("idle", "blocked"), true);
	assert.equal(shouldWake("working", "unknown"), true);
	assert.equal(shouldWake(undefined, "unknown"), false);
});

test("the task directory follows from the agent's sandbox and its repo", () => {
	const sandboxes = [{ name: "pi-webapp-web-1", workspaces: ["/Users/me/Work/webapp"] }];
	assert.equal(taskDirOf("/home/me", sandboxes, "webapp-web-1"), "/home/me/.sandboxes/webapp/pi-webapp-web-1");
	assert.equal(taskDirOf("/home/me", sandboxes, "someone-else"), undefined);
});
