import assert from "node:assert/strict";
import { test } from "node:test";
import { eventAgents, lifecycle, logEvent } from "./events.ts";
import { fakeIo } from "./fake-io.ts";
import { SEATS } from "../harness.ts";
import { realIo } from "./io.ts";

test("new up and steer events carry the invoking Pi session", () => {
	const io = Object.assign(fakeIo(), { sessionId: "session-a" });

	logEvent(io, "steer", "webapp-web-1", 'zrób "x"');
	logEvent(io, "up", "webapp-web-2");

	assert.deepEqual(io.calls, [
		["append", "/home/me/.fleet/tasks/fleet-events.log", '2026-09-16T10:00:00.000Z w1:host steer webapp-web-1 session=session-a "zrób \\"x\\""'],
		["append", "/home/me/.fleet/tasks/fleet-events.log", "2026-09-16T10:00:00.000Z w1:host up webapp-web-2 session=session-a"],
	]);
});

test("two Pi sessions sharing a pane only adopt their own events", () => {
	const a = Object.assign(fakeIo(), { sessionId: "session-a" });
	const b = Object.assign(fakeIo(), { sessionId: "session-b" });
	logEvent(a, "up", "worker-a");
	logEvent(a, "steer", "worker-a", "continue");
	logEvent(b, "steer", "worker-b", "continue");
	const log = [...a.calls, ...b.calls].map((call) => call[2]).join("\n");

	assert.deepEqual(eventAgents(log, { sessionId: "session-a" }), ["worker-a"]);
	assert.deepEqual(eventAgents(log, { sessionId: "session-b" }), ["worker-b"]);
	assert.deepEqual(eventAgents(log, { sessionId: "" }), []);
});

test("legacy and ownerless events never cause automatic watching", () => {
	const log = [
		"2026-09-16T10:00:00.000Z w1:host up worker-a",
		'2026-09-16T10:01:00.000Z w1:host steer worker-b "continue"',
		"2026-09-16T10:02:00.000Z w1:host up worker-c session=",
		"not a line",
	].join("\n");

	assert.deepEqual(eventAgents(log, { sessionId: "w1:host" }), []);
	assert.deepEqual(eventAgents(log, { sessionId: "" }), []);
});

test("the shell Pi session id reaches event logging", (t) => {
	const previous = process.env.PI_SESSION_ID;
	process.env.PI_SESSION_ID = "shell-session";
	t.after(() => { if (previous === undefined) delete process.env.PI_SESSION_ID; else process.env.PI_SESSION_ID = previous; });
	const io = realIo("/home/me", SEATS.pi);
	const append = t.mock.method(io, "append", (_path: string, _line: string) => {});

	logEvent(io, "up", "worker-a");

	assert.match(append.mock.calls[0].arguments[1], / session=shell-session$/);
});

test("a harness without a shell session id owns events by pane", () => {
	const log = [
		"2026-09-16T10:00:00.000Z w1:host up worker-a session=",
		"2026-09-16T10:01:00.000Z w2:other up worker-b session=",
	].join("\n");

	assert.deepEqual(eventAgents(log, { pane: "w1:host" }), ["worker-a"]);
});

test("a harness that watches through its CLI logs events in its writable fleet cache", () => {
	const io = fakeIo({}, SEATS.claude);

	logEvent(io, "down", "worker-a");

	assert.deepEqual(io.calls, [["append", "/home/me/.fleet/tasks/fleet-events.log", "2026-09-16T10:00:00.000Z w1:host down worker-a session="]]);
});

test("a container taken down is closed until it comes up again", () => {
	const log = [
		"2026-09-16T10:00:00.000Z w1:host up worker-a session=s",
		'2026-09-16T10:01:00.000Z w1:host steer worker-a session=s "go"',
		"2026-09-16T10:02:00.000Z w1:host down worker-a session=s",
		"2026-09-16T10:03:00.000Z w1:host down worker-b session=s",
		"2026-09-16T10:04:00.000Z w1:host up worker-b session=s",
	].join("\n");

	const { closed, steered } = lifecycle(log);

	assert.deepEqual([...closed], ["worker-a"]);
	assert.equal(steered.get("worker-a"), "2026-09-16T10:01:00.000Z");
	assert.deepEqual(eventAgents(log, { sessionId: "s" }), ["worker-b"]);
});

test("a pane owns a container while its latest up or steer came from that pane", () => {
	const log = [
		"2026-09-16T10:00:00.000Z w1:host up worker-a session=",
		"2026-09-16T10:01:00.000Z w2:other up worker-b session=",
		"2026-09-16T10:02:00.000Z w1:host up worker-c session=",
		'2026-09-16T10:03:00.000Z w2:other steer worker-c session= "go"',
		"2026-09-16T10:04:00.000Z w1:host up worker-d session=",
		"2026-09-16T10:05:00.000Z w2:other down worker-d session=",
	].join("\n");

	assert.deepEqual(eventAgents(log, { pane: "w1:host" }), ["worker-a"]);
	assert.deepEqual(eventAgents(log, { pane: "w2:other" }), ["worker-b", "worker-c"]);
});

test("a Pi session keeps a container it put up after another session steers it, until it is taken down", () => {
	const log = [
		"2026-09-16T10:00:00.000Z w1:host up worker-a session=session-a",
		'2026-09-16T10:01:00.000Z w2:other steer worker-a session=session-b "go"',
		"2026-09-16T10:02:00.000Z w1:host up worker-b session=session-a",
		"2026-09-16T10:03:00.000Z w2:other down worker-b session=session-b",
	].join("\n");

	assert.deepEqual(eventAgents(log, { sessionId: "session-a" }), ["worker-a"]);
	assert.deepEqual(eventAgents(log, { sessionId: "session-b" }), ["worker-a"]);
});
