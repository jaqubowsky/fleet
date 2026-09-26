import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net from "node:net";
import { test, type TestContext } from "node:test";
import { HARNESSES } from "../harness.ts";
import { fakeIo } from "./fake-io.ts";
import { agentName } from "./name.ts";
import { fleetAgents, paneScope, wakeLines, wakeName, watch } from "./watch.ts";

const agents = [
	{ name: "claude-webapp-a", pane_id: "w1:p1", agent_status: "working" },
	{ name: "claude-webapp-b", pane_id: "w1:p2", agent_status: "idle" },
	{ name: "notes", pane_id: "w1:p3", agent_status: "idle" },
];
const sandboxes = [
	{ name: "claude-webapp-a", workspaces: ["/w/webapp"] },
	{ name: "claude-webapp-b", workspaces: ["/w/webapp"] },
];

function herdr(
	t: TestContext,
	agents: { name: string; pane_id: string; agent_status: string }[],
	harness = HARNESSES.claude,
) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const intervals = new Map<number, () => void>();
	t.mock.method(globalThis, "setInterval", ((
		callback: () => void,
		delay: number,
	) => {
		intervals.set(delay, callback);
		return 1;
	}) as typeof setInterval);
	const sockets: (EventEmitter & { destroyed: boolean; written: string[] })[] =
		[];
	t.mock.method(net, "createConnection", () => {
		const socket = Object.assign(new EventEmitter(), {
			destroyed: false,
			written: [] as string[],
			write(line: string) {
				this.written.push(line);
			},
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
					workspaces: ["/w/webapp"],
				})),
			},
			"herdr agent list": { result: { agents } },
		},
		harness,
	);
	const status = (pane: string, next: string) => {
		for (const socket of sockets)
			socket.emit(
				"data",
				Buffer.from(
					`${JSON.stringify({ event: "pane.agent_status_changed", data: { pane_id: pane, agent_status: next } })}\n`,
				),
			);
	};
	return { io, intervals, sockets, status };
}

test("watch follows the harness's containers and nothing else in herdr", () => {
	assert.deepEqual(
		fleetAgents(agents, sandboxes, undefined).map((a) => a.name),
		["claude-webapp-a", "claude-webapp-b"],
	);
	assert.deepEqual(
		fleetAgents(agents, sandboxes, ["claude-webapp-b"]).map((a) => a.name),
		["claude-webapp-b"],
	);
	assert.deepEqual(fleetAgents(agents, sandboxes, []), []);
});

test("a long sandbox name picks the agent herdr named after it", () => {
	const sandbox = "pi-webapp-bug-ledger-repost-status-bar";
	const agents = [
		{ pane_id: "w:p1", name: "pi-webapp-bug-ledger-re-c7eb7c0" },
		{ pane_id: "w:p2", name: "pi-webapp-web-1705-no-798572e" },
	];
	const sandboxes = [
		sandbox,
		"pi-webapp-web-1705-no-date-picker-for-import",
	].map((name) => ({ name, workspaces: ["/w/webapp"] }));

	assert.deepEqual(
		fleetAgents(agents, sandboxes, [sandbox]).map((a) => a.pane_id),
		["w:p1"],
	);
});

test("a wake names the agent, then the full sandbox and its change, before the status.md projection", () => {
	const text = wakeLines(
		"claude-household-budget-35d0485",
		"claude-household-budget-t01-skeleton",
		"working -> idle",
		"status: ready-for-host",
	);
	assert.equal(
		text,
		"[fleet] claude-household-budget-35d0485: claude-household-budget-t01-skeleton working -> idle\n\nstatus: ready-for-host",
	);
	assert.equal(wakeName(text), "claude-household-budget-35d0485");
});

test("CLI watch reconciles status and reconnects after a closed stream", (t: TestContext) => {
	const agents = [
		{ name: "claude-webapp-a", pane_id: "w1:p1", agent_status: "working" },
	];
	const { io, intervals, sockets } = herdr(t, agents);
	let snapshots = 0;
	io.herdr = <T>() => {
		snapshots++;
		if (snapshots === 2) throw new Error("herdr unavailable");
		return { result: { agents } } as T;
	};
	watch(() => undefined, io);

	agents[0].agent_status = "idle";
	sockets[0].destroyed = true;
	sockets[0].emit("close");
	t.mock.timers.tick(3000);
	t.mock.timers.tick(3000);
	t.mock.timers.tick(1000);

	assert.equal(sockets.length, 2);
	assert.equal(
		io.lines.filter((line) => line.startsWith("[fleet] claude-webapp-a:"))
			.length,
		1,
	);
	assert.match(
		io.lines.at(-1) ?? "",
		/^\[fleet\] claude-webapp-a: working -> idle\n/,
	);

	agents[0].agent_status = "done";
	intervals.get(30_000)?.();
	t.mock.timers.tick(1000);

	assert.equal(
		io.lines.filter((line) => line.startsWith("[fleet] claude-webapp-a:"))
			.length,
		1,
	);
});

test("a transient idle between active turns does not wake the host", (t: TestContext) => {
	const { io, status } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	const wakes: string[] = [];
	watch(
		() => undefined,
		io,
		(text) => wakes.push(text),
	);

	status("worker:pane", "idle");
	status("worker:pane", "working");
	t.mock.timers.tick(1100);

	assert.deepEqual(wakes, []);
});

test("a watch wake names the full sandbox beside herdr's shortened agent", (t: TestContext) => {
	const sandbox = "claude-household-budget-t01-skeleton";
	const agent = agentName(sandbox);
	const { io, status } = herdr(t, [{ name: agent, pane_id: "t01:pane", agent_status: "working" }]);
	const sbx = io.sbx;
	io.sbx = (args, opts) =>
		args[0] === "ls" ? JSON.stringify({ sandboxes: [{ name: sandbox, workspaces: ["/w/household-budget"] }] }) : sbx(args, opts);
	const wakes: string[] = [];
	watch(() => undefined, io, (text) => wakes.push(text));

	status("t01:pane", "idle");
	t.mock.timers.tick(1100);

	assert.equal(wakes.length, 1);
	assert.ok(wakes[0].startsWith(`[fleet] ${agent}: ${sandbox} working -> idle\n`), wakes[0]);
});

test("different containers wake independently while an identical transition stays deduplicated", (t: TestContext) => {
	const { io, status } = herdr(t, [
		{ name: "claude-first", pane_id: "first:pane", agent_status: "working" },
		{ name: "claude-second", pane_id: "second:pane", agent_status: "working" },
	]);
	const wakes: string[] = [];
	watch(
		() => ["claude-first", "claude-second"],
		io,
		(text) => wakes.push(text),
	);

	for (const pane of ["first:pane", "first:pane", "second:pane"]) {
		status(pane, "idle");
		t.mock.timers.tick(1100);
	}

	assert.equal(wakes.length, 2);
	assert.match(wakes[0], /^\[fleet\] claude-first: working -> idle\n\nstatus:/);
	assert.match(wakes[1], /^\[fleet\] claude-second: working -> idle\n\nstatus:/);
	assert.doesNotMatch(wakes[0], /claude-second/);
});

test("each wake counts only the log lines added since its previous wake", (t: TestContext) => {
	const { io, status } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	const file = "/home/me/.sandboxes/webapp/claude-worker/status.md";
	const wakes: string[] = [];
	watch(
		() => undefined,
		io,
		(text) => wakes.push(text),
	);

	io.files[file] = "status: analyzing\n\n## Log\n- Scope set; analysis.md\n";
	status("worker:pane", "idle");
	t.mock.timers.tick(1100);
	status("worker:pane", "working");
	io.files[file] =
		"status: implementing\n\n## Log\n- Scope set; analysis.md\n- Baseline build passed; logs/initial-build.log\n";
	status("worker:pane", "idle");
	t.mock.timers.tick(1100);

	assert.equal(wakes.length, 2);
	assert.match(wakes[0], /log: 1 entry in status\.md\n\ncommits:/);
	assert.match(wakes[1], /log: 1 new entry in status\.md\n\ncommits:/);
	assert.doesNotMatch(wakes[1], /Scope set/);
});

test("an empty scope asks herdr and sbx nothing", (t: TestContext) => {
	const { io, intervals } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);

	watch(() => [], io);
	intervals.get(30_000)?.();

	assert.deepEqual(io.calls, []);
});

test("a stopped watch neither refreshes nor reconnects", (t: TestContext) => {
	const { io, intervals, sockets } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	const stop = watch(() => undefined, io).stop;
	const asked = io.calls.length;

	stop();
	sockets[0].emit("close");
	t.mock.timers.tick(3000);
	intervals.get(30_000)?.();

	assert.equal(sockets.length, 1);
	assert.equal(io.calls.length, asked);
});

test("an omp container wakes its host on herdr's status like any other harness", (t: TestContext) => {
	const { io, status } = herdr(
		t,
		[{ name: "omp-webapp-a", pane_id: "w1:p1", agent_status: "working" }],
		HARNESSES.omp,
	);
	const wakes: string[] = [];
	watch(
		() => undefined,
		io,
		(text) => wakes.push(text),
	);

	status("w1:p1", "done");
	t.mock.timers.tick(1100);

	assert.ok(
		io.lines.includes("[fleet] watching omp-webapp-a working"),
		io.lines.join("\n"),
	);
	assert.equal(wakes.length, 1);
	assert.match(wakes[0], /^\[fleet\] omp-webapp-a: working -> done\n/);
	assert.ok(
		!io.calls.some(
			(c) => c[0] === "herdr" && c[1] === "agent" && c[2] === "read",
		),
	);
});

for (const h of Object.values(HARNESSES)) {
	test(`the ${h.name} watch subscribes to herdr's status and exit events`, (t: TestContext) => {
		const { io, sockets } = herdr(
			t,
			[
				{ name: `${h.prefix}webapp-a`, pane_id: "w1:p1", agent_status: "working" },
			],
			h,
		);
		watch(() => undefined, io);

		sockets[0].emit("connect");

		const { params } = JSON.parse(sockets[0].written[0]) as {
			params: { subscriptions: { type: string }[] };
		};
		assert.deepEqual(
			params.subscriptions.map((s) => s.type),
			["pane.agent_status_changed", "pane.exited"],
		);
	});
}

test("a turn that ends with status.md unchanged and no steer since the last wake wakes nobody", (t: TestContext) => {
	const { io, status } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	io.files["/home/me/.sandboxes/webapp/claude-worker/status.md"] =
		"status: reviewing\nattention: none\n";
	const wakes: string[] = [];
	watch(
		() => undefined,
		io,
		(text) => wakes.push(text),
	);

	for (const next of ["done", "working", "idle", "working", "done"]) {
		status("worker:pane", next);
		t.mock.timers.tick(1100);
	}

	assert.equal(wakes.length, 1);
});

test("a steer since the last wake lets the next settle wake the host again", (t: TestContext) => {
	const { io, status } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	io.files["/home/me/.sandboxes/webapp/claude-worker/status.md"] =
		"status: blocked\nattention: waiting\n";
	const wakes: string[] = [];
	watch(
		() => undefined,
		io,
		(text) => wakes.push(text),
	);

	status("worker:pane", "idle");
	t.mock.timers.tick(1100);
	io.files["/home/me/.claude/fleet-cache/fleet-events.log"] =
		'2026-09-16T10:05:00.000Z w1:host steer claude-worker session= "go on"\n';
	status("worker:pane", "working");
	status("worker:pane", "idle");
	t.mock.timers.tick(1100);

	assert.equal(wakes.length, 2);
});

test("a container taken down wakes nobody, neither its last settle nor its exit", (t: TestContext) => {
	const { io, status, sockets } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	const wakes: string[] = [];
	watch(
		() => undefined,
		io,
		(text) => wakes.push(text),
	);

	io.files["/home/me/.claude/fleet-cache/fleet-events.log"] =
		"2026-09-16T10:05:00.000Z w1:host down claude-worker session=\n";
	status("worker:pane", "idle");
	t.mock.timers.tick(1100);
	for (const socket of sockets)
		socket.emit(
			"data",
			Buffer.from(
				`${JSON.stringify({ event: "pane.exited", data: { pane_id: "worker:pane" } })}\n`,
			),
		);

	assert.deepEqual(wakes, []);
});

test("a working container whose status.md says it stopped on an error wakes the host once", (t: TestContext) => {
	const { io, intervals } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	const wakes: string[] = [];
	watch(
		() => undefined,
		io,
		(text) => wakes.push(text),
	);

	io.files["/home/me/.sandboxes/webapp/claude-worker/status.md"] =
		"status: blocked\nattention: the agent stopped on an error: fetch failed\n";
	intervals.get(30_000)?.();
	intervals.get(30_000)?.();

	assert.equal(wakes.length, 1);
	assert.match(
		wakes[0],
		/^\[fleet\] claude-worker: working -> stopped on an error\n\nstatus: blocked/,
	);
});

test("a working container whose tool calls keep failing wakes the host once per streak, with its activity", (t: TestContext) => {
	const { io, intervals } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	const wakes: string[] = [];
	watch(
		() => undefined,
		io,
		(text) => wakes.push(text),
	);
	const log = "/home/me/.sandboxes/webapp/claude-worker/logs/activity.jsonl";
	const failures = (from: number, count: number) =>
		Array.from({ length: count }, (_, i) =>
			JSON.stringify({ at: `2026-09-16T09:${String(from + i).padStart(2, "0")}:00Z`, tool: "Bash", ok: false, agent: "main" }),
		).join("\n");

	io.files[log] = failures(50, 4);
	intervals.get(60_000)?.();
	io.files[log] = failures(50, 5);
	intervals.get(60_000)?.();
	io.files[log] = failures(50, 6);
	intervals.get(60_000)?.();
	const firstStreak = wakes.length;
	io.files[log] = [
		failures(50, 6),
		JSON.stringify({ at: "2026-09-16T09:56:00Z", tool: "Bash", ok: true, agent: "main" }),
		failures(57, 5),
	].join("\n");
	intervals.get(60_000)?.();

	assert.equal(firstStreak, 1);
	assert.equal(wakes.length, 2);
	assert.match(wakes[0], /^\[fleet\] claude-worker: working, 5 tool calls failed in a row\n\n/);
	assert.match(wakes[0], /\n\nactivity: up 10m, silent 6m, 5 tool calls, last Bash, 5 failed in a row$/);
});

test("a refresh that keeps failing the same way logs it once", (t: TestContext) => {
	const { io } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	io.herdr = (() => {
		throw new Error("sbx ls --json failed (1) docker hub refresh lock held");
	}) as typeof io.herdr;
	watch(() => undefined, io);

	t.mock.timers.tick(3000);
	t.mock.timers.tick(3000);

	assert.equal(
		io.lines.filter((line) => line.includes("refresh lock")).length,
		1,
	);
});

test("CLI watch follows the containers its pane owns, and named ones beside them", () => {
	const io = fakeIo({}, HARNESSES.claude);
	io.files["/home/me/.claude/fleet-cache/fleet-events.log"] = [
		"2026-09-16T10:00:00.000Z w1:host up claude-mine session=",
		"2026-09-16T10:01:00.000Z w2:other up claude-theirs session=",
		"2026-09-16T10:02:00.000Z w2:other up claude-named session=",
	].join("\n");

	assert.deepEqual(paneScope(io, [])(), ["claude-mine"]);
	assert.deepEqual(paneScope(io, ["claude-named"])(), ["claude-named", "claude-mine"]);
});

test("a container steered from another pane leaves the watch without a wake", (t: TestContext) => {
	const { io, intervals } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	const log = "/home/me/.claude/fleet-cache/fleet-events.log";
	io.files[log] = "2026-09-16T10:00:00.000Z w1:host up claude-worker session=";
	const wakes: string[] = [];
	watch(paneScope(io, []), io, (text) => wakes.push(text));

	io.files[log] += '\n2026-09-16T10:01:00.000Z w2:other steer claude-worker session= "go"';
	intervals.get(30_000)?.();

	assert.deepEqual(wakes, []);
});

test("CLI watch outside a herdr pane follows only the containers it names", () => {
	const io = Object.assign(fakeIo({}, HARNESSES.claude), { pane: "-" });
	io.files["/home/me/.claude/fleet-cache/fleet-events.log"] =
		"2026-09-16T10:00:00.000Z - up claude-shell session=";

	assert.deepEqual(paneScope(io, [])(), []);
	assert.deepEqual(paneScope(io, ["claude-named"])(), ["claude-named"]);
});
