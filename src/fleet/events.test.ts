import assert from "node:assert/strict";
import { test } from "node:test";
import { eventAgents, logEvent } from "./events.ts";
import { fakeIo } from "./fake-io.ts";

test("an up or steer lands in the events log with the host pane", () => {
	const io = fakeIo();

	logEvent(io, "steer", "webapp-web-1", 'zrób "x"');
	logEvent(io, "up", "webapp-web-2");

	assert.deepEqual(io.calls, [
		["append", "/home/me/.pi/agent/fleet-events.log", '2026-09-16T10:00:00.000Z w1:host steer webapp-web-1 "zrób \\"x\\""'],
		["append", "/home/me/.pi/agent/fleet-events.log", "2026-09-16T10:00:00.000Z w1:host up webapp-web-2"],
	]);
});

test("the agents one pane touched, each once, garbage skipped", () => {
	const log = [
		"2026-09-16T10:00:00.000Z w1:host up webapp-web-1",
		"2026-09-16T10:01:00.000Z w1:host steer webapp-web-1 \"go\"",
		"2026-09-16T10:02:00.000Z w2:other steer webapp-web-9 \"go\"",
		"2026-09-16T10:03:00.000Z w1:host steer webapp-web-2 \"go\"",
		"not a line",
		"",
	].join("\n");

	assert.deepEqual(eventAgents(log, "w1:host"), ["webapp-web-1", "webapp-web-2"]);
	assert.deepEqual(eventAgents(log, ""), ["webapp-web-1", "webapp-web-9", "webapp-web-2"]);
});
