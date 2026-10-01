import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { EventEmitter } from "node:events";
import net from "node:net";
import fleetMonitor from "../../extensions/fleet-monitor.ts";
import { SEATS } from "../harness.ts";
import { EVENTS_LOG, logEvent } from "./events.ts";
import { fakeIo } from "./fake-io.ts";
import {
	idleStalled,
	STALL_MS,
	taskDirOf,
	shouldWake,
	stalled,
	transition,
} from "./monitor.ts";

function monitorRuntime(
	t: TestContext,
	h = SEATS.pi,
	agents = [
		{ name: "pi-worker", pane_id: "worker:pane", agent_status: "working" },
	],
	herdr: unknown = { result: { agents } },
) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const previousOwner = h.sessionIdEnv ? process.env[h.sessionIdEnv] : undefined;
	t.after(() => {
		if (!h.sessionIdEnv) return;
		if (previousOwner === undefined) delete process.env[h.sessionIdEnv];
		else process.env[h.sessionIdEnv] = previousOwner;
	});
	const sockets: (EventEmitter & { destroyed: boolean })[] = [];
	t.mock.method(net, "createConnection", () => {
		const socket = Object.assign(new EventEmitter(), {
			destroyed: false,
			write() {},
			destroy() {
				this.destroyed = true;
			},
		});
		sockets.push(socket);
		return socket as unknown as net.Socket;
	});
	const io = fakeIo(
		{
			"sbx ls --json": {
				sandboxes: agents.map((a) => ({
					name: a.name,
					agent: "pi",
					workspaces: ["/w/repo"],
				})),
			},
			"herdr agent list": herdr,
		},
		h,
	);
	const events = (...lines: string[]) => {
		io.files[`${io.home}/${EVENTS_LOG}`] = `${lines.join("\n")}\n`;
	};
	const start = (sessionId: string) => {
		const handlers: Record<string, (...args: any[]) => any> = {};
		const tools: Record<string, { execute: (...args: any[]) => any }> = {};
		const messages: {
			message: { content: string };
			options: { deliverAs: string; triggerTurn: boolean };
		}[] = [];
		const notices: string[] = [];
		fleetMonitor(
			h,
			io,
		)({
			on: (name: string, fn: any) => {
				handlers[name] = fn;
			},
			registerTool: (tool: any) => {
				tools[tool.name] = tool;
			},
			registerCommand() {},
			sendMessage: (message: any, options: any) =>
				messages.push({ message, options }),
			ui: { notify: (text: string) => notices.push(text) },
		});
		t.after(() => handlers.session_shutdown());
		handlers.session_start(
			{},
			{ sessionManager: { getSessionId: () => sessionId } },
		);
		return { handlers, tools, messages, notices };
	};
	const exit = (pane = "worker:pane") => {
		for (const socket of sockets.filter((s) => !s.destroyed))
			socket.emit(
				"data",
				Buffer.from(
					`${JSON.stringify({ event: "pane.exited", data: { pane_id: pane } })}\n`,
				),
			);
	};
	const settle = (pane = "worker:pane") => {
		for (const socket of sockets.filter((s) => !s.destroyed))
			socket.emit(
				"data",
				Buffer.from(
					`${JSON.stringify({ event: "pane.agent_status_changed", data: { pane_id: pane, agent_status: "idle" } })}\n`,
				),
			);
		t.mock.timers.tick(1100);
	};
	return { events, exit, start, settle };
}

test("only the invoking Pi session receives automatic fleet notifications", (t) => {
	const runtime = monitorRuntime(t);
	const writer = Object.assign(fakeIo(), { sessionId: "session-a" });
	logEvent(writer, "up", "pi-worker");
	runtime.events(writer.calls[0][2]);
	const a = runtime.start("session-a");
	const b = runtime.start("session-b");

	runtime.settle();

	assert.equal(a.messages.length, 1);
	assert.match(a.messages[0].message.content, /^\[fleet\] pi-worker:/);
	assert.equal(
		a.notices.filter((n) => n.startsWith("[fleet] pi-worker:")).length,
		1,
	);
	assert.deepEqual(b.messages, []);
	assert.deepEqual(
		b.notices.filter((n) => n.startsWith("[fleet] pi-worker:")),
		[],
	);
});

for (const h of [SEATS.pi]) {
	test(`a fleet command the ${h.name} model runs carries the session that owns it`, (t) => {
		const watcher = monitorRuntime(t, h).start("session-a");
		const run = (command: string) => {
			const event = { toolName: "bash", input: { command } };
			const result = watcher.handlers.tool_call(event);
			return result?.input?.command ?? event.input.command;
		};

		assert.equal(
			run('fleet steer pi-worker "go"'),
			`export FLEET_SEAT=pi ${h.sessionIdEnv}="session-a"; fleet steer pi-worker "go"`,
		);
		assert.equal(
			run("cd /w/repo && fleet up task"),
			`export FLEET_SEAT=pi ${h.sessionIdEnv}="session-a"; cd /w/repo && fleet up task`,
		);
		assert.equal(run("git status"), "git status");
		assert.equal(run("cat ~/fleet-notes.md"), "cat ~/fleet-notes.md");
	});
}

test("a watcher that cannot reach herdr says so in the session once per trouble", async (t) => {
	const runtime = monitorRuntime(
		t,
		SEATS.pi,
		[],
		new Error("herdr: connection refused"),
	);
	const watcher = runtime.start("session-a");

	await watcher.tools.fleet_watch.execute("call", { agents: "" });
	t.mock.timers.tick(3100);
	t.mock.timers.tick(3100);

	assert.equal(
		watcher.notices.filter((n) => n.includes("connection refused")).length,
		1,
	);
});

test("explicit fleet watch delivers a follow-up turn without waiting for user input", async (t) => {
	const runtime = monitorRuntime(t);
	const watcher = runtime.start("session-b");

	await watcher.tools.fleet_watch.execute("call", { agents: "pi-worker" });
	runtime.settle();

	assert.equal(watcher.messages.length, 1);
	assert.deepEqual(watcher.messages[0].options, {
		deliverAs: "followUp",
		triggerTurn: true,
	});
});

test("a container working past the stall window rings once, then again after the ring window", () => {
	const minute = 60_000;
	const entries = [
		{ pane: "w:p1", status: "working", since: 0, rang: 0 },
		{ pane: "w:p2", status: "working", since: 15 * minute, rang: 15 * minute },
		{ pane: "w:p3", status: "idle", since: 0, rang: 0 },
		{ pane: "w:p4", status: "working", since: 0, rang: 25 * minute },
	];

	assert.deepEqual(stalled(entries, 30 * minute, 20 * minute, 15 * minute), [
		"w:p1",
	]);
	assert.deepEqual(stalled(entries, 40 * minute, 20 * minute, 15 * minute), [
		"w:p1",
		"w:p2",
		"w:p4",
	]);
});

test("an idle container paused at the stop its order named is not stalled, one idle mid-step is", () => {
	assert.equal(idleStalled("idle", "paused", STALL_MS), false);
	assert.equal(idleStalled("idle", "implementing", STALL_MS), true);
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
	const sandboxes = [
		{
			name: "pi-webapp-web-1",
			agent: "pi",
			workspaces: ["/Users/me/Work/webapp"],
		},
	];
	assert.equal(
		taskDirOf("/home/me", sandboxes, "pi-webapp-web-1"),
		"/home/me/.fleet/tasks/webapp/pi-webapp-web-1",
	);
	assert.equal(taskDirOf("/home/me", sandboxes, "someone-else"), undefined);
	const io = fakeIo({
		"read /home/me/.fleet/config/fleet/pi-webapp-web-1.json": JSON.stringify({
			version: 1,
			task: "/home/me/.fleet/tasks/groups/a-b-c/pi-webapp-web-1",
			repositories: ["a", "b", "c"].map((name) => ({
				repo: `/${name}`,
				name: `owner/${name}`,
				base: "main",
				baseSha: "1".repeat(40),
				branch: "task",
				workspace: `/${name}`,
				served: "",
			})),
		}),
	});
	assert.equal(
		taskDirOf(io.home, sandboxes, "pi-webapp-web-1", io),
		"/home/me/.fleet/tasks/groups/a-b-c/pi-webapp-web-1",
	);
});

test("a wake that lands while the host works waits for its turn to end", async (t) => {
	const runtime = monitorRuntime(t);
	const watcher = runtime.start("session-a");
	await watcher.tools.fleet_watch.execute("call", { agents: "pi-worker" });

	watcher.handlers.agent_start();
	runtime.settle();
	const during = watcher.messages.length;
	watcher.handlers.agent_end();

	assert.equal(during, 0);
	assert.equal(watcher.messages.length, 1);
	assert.match(
		watcher.messages[0].message.content,
		/^\[fleet\] pi-worker: working -> idle\n/,
	);
});

test("a container the host takes down mid-turn arrives after the turn as taken down, and its held settle never does", async (t) => {
	const runtime = monitorRuntime(t);
	const watcher = runtime.start("session-a");
	await watcher.tools.fleet_watch.execute("call", { agents: "pi-worker" });

	watcher.handlers.agent_start();
	runtime.settle();
	runtime.events(
		"2026-09-16T10:05:00.000Z w1:host down pi-worker session=session-a",
	);
	runtime.exit();
	watcher.handlers.agent_end();

	assert.equal(watcher.messages.length, 1);
	assert.match(
		watcher.messages[0].message.content,
		/^\[fleet\] pi-worker: idle -> taken down\n/,
	);
});
