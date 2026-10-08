import assert from "node:assert/strict";
import { test } from "node:test";
import { eventAgents, lifecycle, logEvent, runtimeOf } from "./events.ts";
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

test("runtime sums several stops without counting a repeated stop twice", () => {
	const log = [
		"2026-09-16T10:00:00Z w1:p created worker session=a runtime=1",
		"2026-09-16T10:10:00Z w1:p stop worker session=a",
		"2026-09-16T10:20:00Z w1:p stop worker session=a",
		"2026-09-16T10:40:00Z w1:p start worker session=a",
		"2026-09-16T10:45:00Z w1:p stop worker session=a",
		"2026-09-16T10:50:00Z w1:p start worker session=a",
	].join("\n");

	const runtime = runtimeOf(log, "worker", new Date("2026-09-16T11:00:00Z"));

	assert.equal(runtime.coverage, "complete");
	assert.equal(runtime.elapsed_ms, 60 * 60_000);
	assert.equal(runtime.stopped_ms, 35 * 60_000);
	assert.equal(runtime.running_ms, 25 * 60_000);
	assert.equal(runtime.stop_count, 2);
	assert.equal(runtime.restart_count, 2);
});

test("runtime follows the latest creation rather than a previous container", () => {
	const log = [
		"2026-09-16T09:00:00Z w1:p created worker session=a runtime=1",
		"2026-09-16T09:30:00Z w1:p down worker session=a",
		"2026-09-16T10:00:00Z w1:p created worker session=b runtime=1",
		"2026-09-16T10:10:00Z w1:p stop another-worker session=b",
		"2026-09-16T12:00:00Z w1:p stop worker session=b",
	].join("\n");

	const runtime = runtimeOf(log, "worker", new Date("2026-09-16T11:00:00Z"));

	assert.equal(runtime.coverage, "complete");
	assert.equal(runtime.elapsed_ms, 60 * 60_000);
	assert.equal(runtime.stopped_ms, 0);
	assert.equal(runtime.started_at, "2026-09-16T10:00:00Z");
});

test("an unmatched start leaves runtime coverage partial", () => {
	const log = [
		"2026-09-16T10:00:00Z w1:p created worker session=a runtime=1",
		"2026-09-16T10:30:00Z w1:p start worker session=a",
	].join("\n");

	const runtime = runtimeOf(log, "worker", new Date("2026-09-16T11:00:00Z"));

	assert.equal(runtime.coverage, "partial");
	assert.equal(runtime.running_ms, undefined);
	assert.equal(runtime.stopped_ms, undefined);
});

test("a missing creation leaves runtime unavailable", () => {
	const runtime = runtimeOf("not an event", "worker", new Date("2026-09-16T11:00:00Z"));

	assert.equal(runtime.coverage, "unavailable");
	assert.equal(runtime.elapsed_ms, undefined);
	assert.equal(runtime.running_ms, undefined);
});

test("stop and start do not change watch ownership", () => {
	const log = [
		"2026-09-16T10:00:00Z w1:p created worker session=a runtime=1",
		"2026-09-16T10:00:01Z w1:p up worker session=a",
		"2026-09-16T10:30:00Z w2:p stop worker session=b",
		"2026-09-16T11:00:00Z w2:p start worker session=b",
	].join("\n");

	assert.deepEqual(eventAgents(log, { sessionId: "a" }), ["worker"]);
	assert.deepEqual(eventAgents(log, { sessionId: "b" }), []);
	assert.deepEqual([...lifecycle(log).closed], []);
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
