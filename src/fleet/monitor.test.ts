import assert from "node:assert/strict";
import { test } from "node:test";
import {
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

test("a transition line only when the status changed", () => {
	assert.equal(transition("working", "idle"), "working -> idle");
	assert.equal(transition(undefined, "idle"), "? -> idle");
	assert.equal(transition("idle", "idle"), undefined);
});

test("one wake per turn end, none between done and idle", () => {
	assert.equal(shouldWake("working", "done"), true);
	assert.equal(shouldWake("done", "idle"), false);
	assert.equal(shouldWake("idle", "done"), false);
	assert.equal(shouldWake("idle", "working"), true);
	assert.equal(shouldWake(undefined, "idle"), true);
	assert.equal(shouldWake("idle", "blocked"), true);
});
