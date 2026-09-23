import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import { join } from "node:path";
import fleetMonitor from "../../extensions/fleet-monitor.ts";
import { HARNESSES } from "../harness.ts";
import { logEvent } from "./events.ts";
import { fakeIo } from "./fake-io.ts";
import {
	type Agent,
	taskDirOf,
	pickAgents,
	shouldWake,
	stalled,
	transition,
} from "./monitor.ts";

function immediate(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

function monitorRuntime(t: TestContext, h = HARNESSES.pi) {
	const home = mkdtempSync(join(os.tmpdir(), "fleet-monitor-"));
	mkdirSync(join(home, `${h.home}/agent`), { recursive: true });
	t.mock.method(os, "homedir", () => home);
	const previousPane = process.env.HERDR_PANE_ID;
	const previousOwner = h.sessionIdEnv ? process.env[h.sessionIdEnv] : undefined;
	delete process.env.HERDR_PANE_ID;
	if (h.sessionIdEnv) delete process.env[h.sessionIdEnv];
	t.after(() => {
		if (previousPane === undefined) delete process.env.HERDR_PANE_ID;
		else process.env.HERDR_PANE_ID = previousPane;
		if (h.sessionIdEnv) {
			if (previousOwner === undefined) delete process.env[h.sessionIdEnv];
			else process.env[h.sessionIdEnv] = previousOwner;
		}
		rmSync(home, { recursive: true, force: true });
	});
	const sockets: EventEmitter[] = [];
	t.mock.method(net, "createConnection", () => {
		const socket = Object.assign(new EventEmitter(), { destroyed: false, write() {}, destroy() { this.destroyed = true; } });
		sockets.push(socket);
		return socket as unknown as net.Socket;
	});
	const start = async (sessionId: string, agents: Agent[] = [{ name: "worker", pane_id: "worker:pane", agent_status: "working" }]) => {
		const events: Record<string, (...args: any[]) => any> = {};
		const tools: Record<string, { execute: (...args: any[]) => any }> = {};
		const messages: { message: { content: string }; options: { deliverAs: string; triggerTurn: boolean } }[] = [];
		const notices: string[] = [];
		fleetMonitor(h)({
			on: (name: string, fn: any) => { events[name] = fn; },
			registerTool: (tool: any) => { tools[tool.name] = tool; },
			registerCommand() {},
			exec: async (command: string) => ({ stdout: command === "herdr" ? JSON.stringify({ result: { agents } }) : '{"sandboxes":[]}' }),
			sendMessage: (message: any, options: any) => messages.push({ message, options }),
			ui: { setStatus() {}, notify: (text: string) => notices.push(text) },
		});
		t.after(() => events.session_shutdown());
		await events.session_start?.({}, { sessionManager: { getSessionId: () => sessionId } });
		await immediate();
		return { tools, messages, notices };
	};
	const status = async (next: string, pane = "worker:pane") => {
		for (const socket of sockets) socket.emit("data", Buffer.from(`${JSON.stringify({ event: "pane.agent_status_changed", data: { pane_id: pane, agent_status: next } })}\n`));
		await immediate();
	};
	const refresh = async () => {
		for (const socket of sockets) socket.emit("data", Buffer.from(`${JSON.stringify({ event: "tab_closed" })}\n`));
		await immediate();
	};
	const settle = async (pane = "worker:pane") => {
		await status("idle", pane);
		await new Promise((resolve) => setTimeout(resolve, 1100));
	};
	return { home, start, settle, status, refresh };
}

test("only the invoking Pi session receives automatic fleet notifications", async (t) => {
	const runtime = monitorRuntime(t);
	const io = Object.assign(fakeIo(), { sessionId: "session-a" });
	logEvent(io, "up", "worker");
	writeFileSync(join(runtime.home, ".pi/agent/fleet-events.log"), io.calls[0][2] + "\n");
	const a = await runtime.start("session-a");
	const b = await runtime.start("session-b");

	await runtime.settle();

	assert.equal(a.messages.length, 1);
	assert.match(a.messages[0].message.content, /^\[fleet\] worker:/);
	assert.equal(a.notices.length, 1);
	assert.deepEqual(b.messages, []);
	assert.deepEqual(b.notices, []);
});

test("OMP exports its session owner and ignores another session's events", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const runtime = monitorRuntime(t, HARNESSES.omp);
	const log = [
		"2026-09-16T10:00:00.000Z - up worker-a session=session-a",
		"2026-09-16T10:01:00.000Z - up worker-b session=session-b",
	].join("\n");
	writeFileSync(join(runtime.home, ".omp/agent/fleet-events.log"), `${log}\n`);
	const watcher = await runtime.start("session-a", [
		{ name: "worker-a", pane_id: "worker-a:pane", agent_status: "working" },
		{ name: "worker-b", pane_id: "worker-b:pane", agent_status: "working" },
	]);

	await runtime.status("idle", "worker-a:pane");
	await runtime.status("idle", "worker-b:pane");
	t.mock.timers.tick(1100);
	await immediate();

	assert.equal(process.env.OMP_SESSION_ID, "session-a");
	assert.equal(watcher.messages.length, 1);
	assert.match(watcher.messages[0].message.content, /^\[fleet\] worker-a: working -> idle\n/);
});

test("OMP watch-all excludes its own session without a pane environment", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const runtime = monitorRuntime(t, HARNESSES.omp);
	const watcher = await runtime.start("session-a", [
		{ name: "host", pane_id: "host:pane", agent_status: "working", agent_session_id: "session-a" },
		{ name: "worker", pane_id: "worker:pane", agent_status: "working", agent_session_id: "container-session" },
	]);
	await watcher.tools.fleet_watch.execute("call", { agents: "" });

	await runtime.status("idle", "host:pane");
	await runtime.status("idle", "worker:pane");
	t.mock.timers.tick(1100);
	await immediate();

	assert.equal(watcher.messages.length, 1);
	assert.match(watcher.messages[0].message.content, /^\[fleet\] worker: working -> idle\n/);
});

test("explicit fleet watch delivers a follow-up turn without waiting for user input", async (t) => {
	const runtime = monitorRuntime(t);
	const watcher = await runtime.start("session-b");

	await watcher.tools.fleet_watch.execute("call", { agents: "worker" });
	await runtime.settle();

	assert.equal(watcher.messages.length, 1);
	assert.deepEqual(watcher.messages[0].options, { deliverAs: "followUp", triggerTurn: true });
});

test("a transient idle between active turns does not wake the host", async (t) => {
	const runtime = monitorRuntime(t);
	const watcher = await runtime.start("session-a");
	await watcher.tools.fleet_watch.execute("call", { agents: "worker" });

	await runtime.status("idle");
	await runtime.status("working");
	await new Promise((resolve) => setTimeout(resolve, 1100));

	assert.deepEqual(watcher.messages, []);
	assert.deepEqual(watcher.notices, []);
});

test("different containers wake independently while an identical transition stays deduplicated", async (t) => {
	const runtime = monitorRuntime(t);
	const watcher = await runtime.start("session-a", [
		{ name: "first", pane_id: "first:pane", agent_status: "working" },
		{ name: "second", pane_id: "second:pane", agent_status: "working" },
	]);
	await watcher.tools.fleet_watch.execute("call", { agents: "first second" });

	await runtime.settle("first:pane");
	await runtime.settle("first:pane");
	await runtime.settle("second:pane");

	assert.equal(watcher.messages.length, 2);
	assert.match(watcher.messages[0].message.content, /^\[fleet\] first: working -> idle\nstatus:/);
	assert.match(watcher.messages[1].message.content, /^\[fleet\] second: working -> idle\nstatus:/);
	assert.doesNotMatch(watcher.messages[0].message.content, /second/);
	for (const { options } of watcher.messages) assert.deepEqual(options, { deliverAs: "followUp", triggerTurn: true });
});

test("a refresh recovers a missed terminal status once", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const runtime = monitorRuntime(t);
	const agents = [{ name: "worker", pane_id: "worker:pane", agent_status: "working" }];
	const watcher = await runtime.start("session-a", agents);
	await watcher.tools.fleet_watch.execute("call", { agents: "worker" });

	agents[0].agent_status = "idle";
	await runtime.refresh();
	await runtime.refresh();
	t.mock.timers.tick(1100);
	await immediate();
	agents[0].agent_status = "done";
	await runtime.refresh();
	t.mock.timers.tick(1100);
	await immediate();

	assert.equal(watcher.messages.length, 1);
	assert.match(watcher.messages[0].message.content, /^\[fleet\] worker: working -> idle\n/);
});

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
