import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { EventEmitter } from "node:events";
import net from "node:net";
import fleetMonitor from "../../extensions/fleet-monitor.ts";
import { HARNESSES } from "../harness.ts";
import { eventsLog, logEvent } from "./events.ts";
import { fakeIo } from "./fake-io.ts";
import { taskDirOf, shouldWake, stalled, transition } from "./monitor.ts";

function monitorRuntime(t: TestContext, h = HARNESSES.pi, agents = [{ name: "worker", pane_id: "worker:pane", agent_status: "working" }]) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const previousOwner = h.sessionIdEnv ? process.env[h.sessionIdEnv] : undefined;
	t.after(() => {
		if (!h.sessionIdEnv) return;
		if (previousOwner === undefined) delete process.env[h.sessionIdEnv];
		else process.env[h.sessionIdEnv] = previousOwner;
	});
	const sockets: (EventEmitter & { destroyed: boolean })[] = [];
	t.mock.method(net, "createConnection", () => {
		const socket = Object.assign(new EventEmitter(), { destroyed: false, write() {}, destroy() { this.destroyed = true; } });
		sockets.push(socket);
		return socket as unknown as net.Socket;
	});
	const io = fakeIo({
		"sbx ls --json": { sandboxes: agents.map((a) => ({ name: `${h.prefix}${a.name}`, workspaces: ["/w/repo"] })) },
		"herdr agent list": { result: { agents } },
	}, h);
	const events = (...lines: string[]) => {
		io.files[`${io.home}/${eventsLog(h)}`] = `${lines.join("\n")}\n`;
	};
	const start = (sessionId: string) => {
		const handlers: Record<string, (...args: any[]) => any> = {};
		const tools: Record<string, { execute: (...args: any[]) => any }> = {};
		const messages: { message: { content: string }; options: { deliverAs: string; triggerTurn: boolean } }[] = [];
		const notices: string[] = [];
		fleetMonitor(h, io)({
			on: (name: string, fn: any) => { handlers[name] = fn; },
			registerTool: (tool: any) => { tools[tool.name] = tool; },
			registerCommand() {},
			sendMessage: (message: any, options: any) => messages.push({ message, options }),
			ui: { notify: (text: string) => notices.push(text) },
		});
		t.after(() => handlers.session_shutdown());
		handlers.session_start({}, { sessionManager: { getSessionId: () => sessionId } });
		return { tools, messages, notices };
	};
	const settle = (pane = "worker:pane") => {
		for (const socket of sockets.filter((s) => !s.destroyed)) socket.emit("data", Buffer.from(`${JSON.stringify({ event: "pane.agent_status_changed", data: { pane_id: pane, agent_status: "idle" } })}\n`));
		t.mock.timers.tick(1100);
	};
	return { events, start, settle };
}

test("only the invoking Pi session receives automatic fleet notifications", (t) => {
	const runtime = monitorRuntime(t);
	const writer = Object.assign(fakeIo(), { sessionId: "session-a" });
	logEvent(writer, "up", "worker");
	runtime.events(writer.calls[0][2]);
	const a = runtime.start("session-a");
	const b = runtime.start("session-b");

	runtime.settle();

	assert.equal(a.messages.length, 1);
	assert.match(a.messages[0].message.content, /^\[fleet\] worker:/);
	assert.equal(a.notices.length, 1);
	assert.deepEqual(b.messages, []);
	assert.deepEqual(b.notices, []);
});

test("OMP exports its session owner and ignores another session's events", (t) => {
	const runtime = monitorRuntime(t, HARNESSES.omp, [
		{ name: "worker-a", pane_id: "worker-a:pane", agent_status: "working" },
		{ name: "worker-b", pane_id: "worker-b:pane", agent_status: "working" },
	]);
	runtime.events(
		"2026-09-16T10:00:00.000Z - up worker-a session=session-a",
		"2026-09-16T10:01:00.000Z - up worker-b session=session-b",
	);
	const watcher = runtime.start("session-a");

	runtime.settle("worker-a:pane");
	runtime.settle("worker-b:pane");

	assert.equal(process.env.OMP_SESSION_ID, "session-a");
	assert.equal(watcher.messages.length, 1);
	assert.match(watcher.messages[0].message.content, /^\[fleet\] worker-a: working -> idle\n/);
});

test("explicit fleet watch delivers a follow-up turn without waiting for user input", async (t) => {
	const runtime = monitorRuntime(t);
	const watcher = runtime.start("session-b");

	await watcher.tools.fleet_watch.execute("call", { agents: "worker" });
	runtime.settle();

	assert.equal(watcher.messages.length, 1);
	assert.deepEqual(watcher.messages[0].options, { deliverAs: "followUp", triggerTurn: true });
});

test("a container working past the stall window rings once, then again after the ring window", () => {
	const minute = 60_000;
	const entries = [
		{ pane: "w:p1", status: "working", since: 0, rang: 0 },
		{ pane: "w:p2", status: "working", since: 15 * minute, rang: 15 * minute },
		{ pane: "w:p3", status: "idle", since: 0, rang: 0 },
		{ pane: "w:p4", status: "working", since: 0, rang: 25 * minute },
	];

	assert.deepEqual(stalled(entries, 30 * minute, 20 * minute, 15 * minute), ["w:p1"]);
	assert.deepEqual(stalled(entries, 40 * minute, 20 * minute, 15 * minute), ["w:p1", "w:p2", "w:p4"]);
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
