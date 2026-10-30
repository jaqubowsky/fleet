import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import fleetMonitor from "../../extensions/fleet-monitor.ts";
import { SEATS } from "../harness.ts";
import { EVENTS_LOG, logEvent } from "./events.ts";
import { fakeIo } from "./fake-io.ts";
import { shouldWake, stalled, transition } from "./monitor.ts";

function monitorRuntime(
	t: TestContext,
	h = SEATS.pi,
	agents = [
		{ name: "pi-worker", address: "t20", state: "working" },
	],
	hc: unknown = { terminals: agents.map((a) => ({ address: a.address, state: "live", status: a.state, turn: 0 })) },
) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const previousOwner = process.env[h.sessionIdEnv];
	t.after(() => {
		if (previousOwner === undefined) delete process.env[h.sessionIdEnv];
		else process.env[h.sessionIdEnv] = previousOwner;
	});
	const io = fakeIo(
		{
			"sbx ls --json": agents.map((a) => ({
				name: a.name,
				agent: "pi",
				workspaces: ["/w/repo"],
			})),
			"hc ls --label fleet=1": hc,
			...Object.fromEntries(agents.map((a) => [`hc get ${a.address}`, { address: a.address, labels: { fleet: "1", "fleet.sandbox": a.name }, status: { state: a.state }, turn: 0 }])),
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
		const statuses: [string, string | undefined][] = [];
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
			ui: {
				notify: (text: string) => notices.push(text),
				setStatus: (key: string, text: string | undefined) => statuses.push([key, text]),
			},
		});
		t.after(() => handlers.session_shutdown());
		handlers.session_start(
			{},
			{ sessionManager: { getSessionId: () => sessionId } },
		);
		return { handlers, tools, messages, notices, statuses };
	};
	const send = (params: Record<string, unknown>) => {
		for (const follower of io.followers.filter((f) => !f.stopped)) follower.onLine(JSON.stringify({ params }));
	};
	let turn = 0;
	const exit = (terminal = "t20") => send({ type: "finished", terminal, data: { exit_code: 0 } });
	const settle = (terminal = "t20") => {
		send({ type: "status", terminal, data: { status: { state: "idle" } } });
		send({ type: "turn", terminal, data: { turn: ++turn } });
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

test("the footer names each container the session watches with its status, and clears at shutdown", (t) => {
	const runtime = monitorRuntime(t);
	const writer = Object.assign(fakeIo(), { sessionId: "session-a" });
	logEvent(writer, "up", "pi-worker");
	runtime.events(writer.calls[0][2]);
	const a = runtime.start("session-a");

	runtime.settle();
	a.handlers.session_shutdown();

	assert.deepEqual(a.statuses, [
		["fleet", "pi-worker working"],
		["fleet", "pi-worker idle"],
		["fleet", undefined],
	]);
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

test("a watcher that cannot reach hc says so in the session once per trouble", async (t) => {
	const runtime = monitorRuntime(
		t,
		SEATS.pi,
		[],
		new Error("hc: connection refused"),
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
		{ name: "pi-a", status: "working", since: 0, rang: 0 },
		{ name: "pi-b", status: "working", since: 15 * minute, rang: 15 * minute },
		{ name: "pi-c", status: "idle", since: 0, rang: 0 },
		{ name: "pi-d", status: "working", since: 0, rang: 25 * minute },
	];

	assert.deepEqual(stalled(entries, 30 * minute, 20 * minute, 15 * minute), [
		"pi-a",
	]);
	assert.deepEqual(stalled(entries, 40 * minute, 20 * minute, 15 * minute), [
		"pi-a",
		"pi-b",
		"pi-d",
	]);
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
		/^\[fleet\] pi-worker: idle$/,
	);
});

test("a container the host takes down mid-turn wakes nobody after the turn, its held settle included", async (t) => {
	const runtime = monitorRuntime(t);
	const watcher = runtime.start("session-a");
	await watcher.tools.fleet_watch.execute("call", { agents: "pi-worker" });

	watcher.handlers.agent_start();
	runtime.settle();
	runtime.events(
		"2026-09-16T10:05:00.000Z t30 down pi-worker session=session-a",
	);
	runtime.exit();
	watcher.handlers.agent_end();

	assert.deepEqual(watcher.messages, []);
});

test("a container another session takes down mid-turn arrives after the turn as taken down, and its held settle never does", async (t) => {
	const runtime = monitorRuntime(t);
	const watcher = runtime.start("session-a");
	await watcher.tools.fleet_watch.execute("call", { agents: "pi-worker" });

	watcher.handlers.agent_start();
	runtime.settle();
	runtime.events(
		"2026-09-16T10:05:00.000Z t31 down pi-worker session=session-b",
	);
	runtime.exit();
	watcher.handlers.agent_end();

	assert.equal(watcher.messages.length, 1);
	assert.match(
		watcher.messages[0].message.content,
		/^\[fleet\] pi-worker: idle -> taken down$/,
	);
});
