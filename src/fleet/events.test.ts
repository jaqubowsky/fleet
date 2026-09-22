import assert from "node:assert/strict";
import { test } from "node:test";
import { eventAgents, logEvent } from "./events.ts";
import { fakeIo } from "./fake-io.ts";
import { realIo } from "./io.ts";

test("new up and steer events carry the invoking Pi session", () => {
	const io = Object.assign(fakeIo(), { sessionId: "session-a" });

	logEvent(io, "steer", "webapp-web-1", 'zrób "x"');
	logEvent(io, "up", "webapp-web-2");

	assert.deepEqual(io.calls, [
		["append", "/home/me/.pi/agent/fleet-events.log", '2026-09-16T10:00:00.000Z w1:host steer webapp-web-1 session=session-a "zrób \\"x\\""'],
		["append", "/home/me/.pi/agent/fleet-events.log", "2026-09-16T10:00:00.000Z w1:host up webapp-web-2 session=session-a"],
	]);
});

test("two Pi sessions sharing a pane only adopt their own events", () => {
	const a = Object.assign(fakeIo(), { sessionId: "session-a" });
	const b = Object.assign(fakeIo(), { sessionId: "session-b" });
	logEvent(a, "up", "worker-a");
	logEvent(a, "steer", "worker-a", "continue");
	logEvent(b, "steer", "worker-b", "continue");
	const log = [...a.calls, ...b.calls].map((call) => call[2]).join("\n");

	assert.deepEqual(eventAgents(log, "session-a"), ["worker-a"]);
	assert.deepEqual(eventAgents(log, "session-b"), ["worker-b"]);
	assert.deepEqual(eventAgents(log, ""), []);
});

test("legacy and ownerless events never cause automatic watching", () => {
	const log = [
		"2026-09-16T10:00:00.000Z w1:host up worker-a",
		'2026-09-16T10:01:00.000Z w1:host steer worker-b "continue"',
		"2026-09-16T10:02:00.000Z w1:host up worker-c session=",
		"not a line",
	].join("\n");

	assert.deepEqual(eventAgents(log, "w1:host"), []);
	assert.deepEqual(eventAgents(log, ""), []);
});

test("the shell Pi session id reaches event logging", (t) => {
	const previous = process.env.PI_SESSION_ID;
	process.env.PI_SESSION_ID = "shell-session";
	t.after(() => { if (previous === undefined) delete process.env.PI_SESSION_ID; else process.env.PI_SESSION_ID = previous; });
	const io = realIo("/home/me");
	const append = t.mock.method(io, "append", (_path: string, _line: string) => {});

	logEvent(io, "up", "worker-a");

	assert.match(append.mock.calls[0].arguments[1], / session=shell-session$/);
});
