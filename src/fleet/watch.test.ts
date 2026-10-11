import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net from "node:net";
import { test, type TestContext } from "node:test";
import { SEATS, KINDS } from "../harness.ts";
import { fakeIo } from "./fake-io.ts";
import { agentName } from "./name.ts";
import { fleetAgents, jsonLines, paneScope, wakeLines, wakeName, watch } from "./watch.ts";

const agents = [
	{ name: "claude-webapp-a", pane_id: "w1:p1", agent_status: "working" },
	{ name: "claude-webapp-b", pane_id: "w1:p2", agent_status: "idle" },
	{ name: "notes", pane_id: "w1:p3", agent_status: "idle" },
];
const sandboxes = [
	{ name: "claude-webapp-a", agent: "claude", workspaces: ["/w/webapp"] },
	{ name: "claude-webapp-b", agent: "claude", workspaces: ["/w/webapp"] },
];

const REPORT = "Added the login rate limit; its tests pass at 9d290c9.";

function leaving(io: ReturnType<typeof fakeIo>) {
	const sbx = io.sbx;
	io.sbx = (args, opts) =>
		args.join(" ") === "ls --json" ? JSON.stringify({ sandboxes: [] }) : sbx(args, opts);
}

function herdr(
	t: TestContext,
	agents: { name: string; pane_id: string; agent_status: string }[],
	seat = SEATS.claude,
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
					agent: a.name.startsWith("pi-") ? "pi" : "claude",
					workspaces: ["/w/webapp"],
				})),
			},
			"herdr agent list": { result: { agents } },
		},
		seat,
	);
	const said: Record<string, string> = {};
	const sessions = (sandbox: string) =>
		`/home/me/.fleet/tasks/webapp/${sandbox}/logs/sessions${sandbox.startsWith("pi-") ? "" : "/projects/-w-webapp"}`;
	const list = io.list;
	io.list = (dir) => (agents.some((a) => sessions(a.name) === dir) ? ["s.jsonl"] : list(dir));
	const read = io.read;
	io.read = (path) => {
		const agent = agents.find((a) => path === `${sessions(a.name)}/s.jsonl`);
		if (!agent) return read(path);
		const content = [{ type: "text", text: said[agent.name] ?? REPORT }];
		return JSON.stringify({ type: "assistant", message: { role: "assistant", content } });
	};
	const status = (pane: string, next: string, seq?: number) => {
		for (const socket of sockets)
			socket.emit(
				"data",
				Buffer.from(
					`${JSON.stringify({ event: "pane.agent_status_changed", data: { pane_id: pane, agent_status: next, state_change_seq: seq } })}\n`,
				),
			);
	};
	return { io, intervals, sockets, status, said };
}

test("a stopped container stays in the status line without waking or probing it", (t) => {
	const { io, status, intervals } = herdr(t, [agents[0]]);
	const sbx = io.sbx;
	io.sbx = (args, opts) => args[0] === "ls"
		? JSON.stringify({ sandboxes: [{ ...sandboxes[0], status: "stopped" }] })
		: sbx(args, opts);
	io.files["/home/me/.fleet/tasks/webapp/claude-webapp-a/logs/sandbox-stop.json"] = JSON.stringify({ pane: "w1:p1" });
	const lines: string[] = [];
	const wakes: string[] = [];
	const handle = watch(() => undefined, io, (text) => wakes.push(text), (line) => lines.push(line));
	t.after(() => handle.stop());

	status("w1:p1", "idle");
	t.mock.timers.tick(1000);
	intervals.get(60_000)?.();

	assert.equal(lines.at(-1), "claude-webapp-a stopped");
	assert.deepEqual(wakes, []);
	assert.equal(io.calls.filter((c) => c[0] === "sbx" && c[1] === "exec").length, 0);
});

test("a stopped tab stays watched after herdr loses the live process", (t) => {
	const { io } = herdr(t, []);
	io.sbx = () => JSON.stringify({ sandboxes: [{ ...sandboxes[0], status: "stopped" }] });
	io.files["/home/me/.fleet/tasks/webapp/claude-webapp-a/logs/sandbox-stop.json"] = JSON.stringify({ pane: "w1:p1" });
	const lines: string[] = [];
	const handle = watch(() => undefined, io, () => {}, (line) => lines.push(line));
	t.after(() => handle.stop());

	handle.refresh();

	assert.equal(lines.at(-1), "claude-webapp-a stopped");
});

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
		{ pane_id: "w:p1", name: "pi-webapp-bug-ledger-rep-87c8fb9" },
		{ pane_id: "w:p2", name: "pi-webapp-web-1705-no-da-1dc5052" },
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

test("a wake names the agent, then the full sandbox and its state, before the agent's last message", () => {
	const text = wakeLines(
		"claude-household-budget-35d0485",
		"claude-household-budget-t01-skeleton",
		"idle",
		REPORT,
	);
	assert.equal(
		text,
		`[fleet] claude-household-budget-35d0485: claude-household-budget-t01-skeleton idle\n\n${REPORT}`,
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
		/^\[fleet\] claude-webapp-a: idle\n\nAdded the login rate limit/,
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

test("a JSON watch prints each wake and each notice as one line a reader can split on newlines", (t: TestContext) => {
	const { io, status } = herdr(t, [
		{ name: "claude-webapp-a", pane_id: "w1:p1", agent_status: "working" },
	]);
	const json = jsonLines(io);
	watch(() => undefined, json.io, json.onWake, json.onTracked);

	status("w1:p1", "idle");
	t.mock.timers.tick(1100);

	const parsed = io.lines.map((line) => JSON.parse(line));
	assert.deepEqual(parsed[0], { watching: "claude-webapp-a working" });
	assert.match(parsed[1].log, /^\[fleet\] watching/);
	assert.match(parsed.at(-1).wake, /^\[fleet\] claude-webapp-a: idle\n\n/);
	assert.ok(io.lines.every((line) => !line.includes("\n")));
});

test("watch reports the containers it follows with each one's status as it changes", (t: TestContext) => {
	const { io, status } = herdr(t, [
		{ name: "claude-webapp-a", pane_id: "w1:p1", agent_status: "working" },
		{ name: "pi-webapp-b", pane_id: "w1:p2", agent_status: "idle" },
	]);
	const reports: string[] = [];

	watch(() => undefined, io, () => {}, (line) => reports.push(line));
	status("w1:p1", "blocked");
	status("w1:p1", "blocked");

	assert.deepEqual(reports, [
		"claude-webapp-a working · pi-webapp-b idle",
		"claude-webapp-a blocked · pi-webapp-b idle",
	]);
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
	const { io, status } = herdr(t, [
		{ name: agent, pane_id: "t01:pane", agent_status: "working" },
	]);
	const sbx = io.sbx;
	io.sbx = (args, opts) =>
		args[0] === "ls"
			? JSON.stringify({
					sandboxes: [
						{ name: sandbox, agent: "claude", workspaces: ["/w/household-budget"] },
					],
				})
			: sbx(args, opts);
	const wakes: string[] = [];
	watch(
		() => undefined,
		io,
		(text) => wakes.push(text),
	);

	status("t01:pane", "idle");
	t.mock.timers.tick(1100);

	assert.equal(wakes.length, 1);
	assert.equal(wakes[0].split("\n")[0], `[fleet] ${agent}: ${sandbox} idle`);
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
	assert.match(wakes[0], /^\[fleet\] claude-first: idle\n\nAdded/);
	assert.match(wakes[1], /^\[fleet\] claude-second: idle\n\nAdded/);
	assert.doesNotMatch(wakes[0], /claude-second/);
});

test("an empty scope asks herdr and sbx nothing", (t: TestContext) => {
	const { io, intervals } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);

	watch(() => [], io);
	intervals.get(30_000)?.();

	assert.deepEqual(io.calls, []);
});

test("a watch with nothing to follow says how to follow a container this pane did not start", (t: TestContext) => {
	const { io } = herdr(t, []);

	watch(() => [], io);

	assert.deepEqual(io.lines, [
		"[fleet] watching nothing yet; fleet up adds containers within 30s, and fleet watch <sandbox> follows one this pane did not start",
	]);
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

for (const h of Object.values(SEATS)) {
	test(`the ${h.name} watch subscribes to herdr's status and exit events`, (t: TestContext) => {
		const { io, sockets } = herdr(
			t,
			[
				{
					name: `${KINDS[h.name].prefix}webapp-a`,
					pane_id: "w1:p1",
					agent_status: "working",
				},
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

test("a steer since the last wake lets the next settle wake the host again", (t: TestContext) => {
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
	t.mock.timers.tick(1100);
	io.files["/home/me/.fleet/tasks/fleet-events.log"] =
		'2026-09-16T10:05:00.000Z w1:host steer claude-worker session= "go on"\n';
	status("worker:pane", "working");
	status("worker:pane", "idle");
	t.mock.timers.tick(1100);

	assert.equal(wakes.length, 2);
});

test("a container a down closes wakes once as taken down, never with its last settle or its exit", (t: TestContext) => {
	const { io, status, sockets } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	const wakes: string[] = [];
	watch(
		() => undefined,
		io,
		(text) => wakes.push(text),
	);

	io.files["/home/me/.fleet/tasks/fleet-events.log"] =
		"2026-09-16T10:05:00.000Z w2:other down claude-worker session=\n";
	status("worker:pane", "idle");
	t.mock.timers.tick(1100);
	for (const socket of sockets)
		socket.emit(
			"data",
			Buffer.from(
				`${JSON.stringify({ event: "pane.exited", data: { pane_id: "worker:pane" } })}\n`,
			),
		);

	assert.equal(wakes.length, 1);
	assert.match(wakes[0], /^\[fleet\] claude-worker: idle -> taken down$/);
});

test("a watched container whose sandbox leaves the list wakes once as taken down while its pane stays", (t: TestContext) => {
	const { io, intervals } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "idle" },
	]);
	const wakes: string[] = [];
	watch(
		() => undefined,
		io,
		(text) => wakes.push(text),
	);

	leaving(io);
	intervals.get(30_000)?.();
	intervals.get(30_000)?.();

	assert.equal(wakes.length, 1);
	assert.match(wakes[0], /^\[fleet\] claude-worker: idle -> taken down$/);
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

test("a sandbox listing that fails the same way on every wake logs it once", (t: TestContext) => {
	const { io, status } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	const wakes: string[] = [];
	watch(
		() => undefined,
		io,
		(text) => wakes.push(text),
	);
	const listed = io.sbx;
	io.sbx = ((args: string[], opts) => {
		if (args[0] === "ls")
			throw new Error(
				"sbx ls --json failed (1)\ndocker daemon failed to start inside the sandbox",
			);
		return listed(args, opts);
	}) as typeof io.sbx;

	status("worker:pane", "blocked");
	status("worker:pane", "working");
	status("worker:pane", "blocked");

	assert.equal(wakes.length, 2);
	assert.equal(
		io.lines.filter((line) => line.includes("docker daemon failed")).length,
		1,
	);
});

function settles(t: TestContext, message: string) {
	const fixture = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	fixture.said["claude-worker"] = message;
	const wakes: string[] = [];
	const handle = watch(() => undefined, fixture.io, (text) => wakes.push(text));
	t.after(() => handle.stop());
	const turn = (seq?: number) => {
		fixture.status("worker:pane", "working");
		fixture.status("worker:pane", "idle", seq);
		t.mock.timers.tick(1000);
	};
	return { ...fixture, wakes, turn };
}

test("a settle wakes the host with its state and the agent's last message", (t) => {
	const message = "Added the column.\n\nOpen questions:\n- Which route?";
	const { io, wakes, turn } = settles(t, message);

	turn();

	assert.deepEqual(wakes, [`[fleet] claude-worker: idle\n\n${message}`]);
	assert.equal(io.calls.filter((c) => c[0] === "herdr" && c[1] === "agent" && c[2] === "read").length, 0);
});

test("a pi container wakes the host with the last message of its own session", (t) => {
	const { io, said, status } = herdr(t, [{ name: "pi-worker", pane_id: "worker:pane", agent_status: "working" }], SEATS.pi);
	said["pi-worker"] = "Checked the trace; nothing to change.";
	const wakes: string[] = [];
	const handle = watch(() => undefined, io, (text) => wakes.push(text));
	t.after(() => handle.stop());

	status("worker:pane", "idle");
	t.mock.timers.tick(1000);

	assert.deepEqual(wakes, ["[fleet] pi-worker: idle\n\nChecked the trace; nothing to change."]);
});

test("a third wake about the same state without a steer in between is not sent", (t) => {
	const { wakes, turn } = settles(t, REPORT);

	turn();
	turn();
	turn();

	assert.equal(wakes.length, 2);
});

test("a steer after two identical wakes lets the next one through", (t) => {
	const { io, wakes, turn } = settles(t, REPORT);

	turn();
	turn();
	io.files["/home/me/.fleet/tasks/fleet-events.log"] =
		'2099-01-01T00:00:00.000Z w1:host steer claude-worker session= "go on"\n';
	turn();

	assert.equal(wakes.length, 3);
});

test("a settle herdr reports again under the same state_change_seq wakes once", (t) => {
	const { wakes, status } = settles(t, REPORT);

	status("worker:pane", "idle", 7);
	t.mock.timers.tick(1000);
	status("worker:pane", "unknown", 7);
	status("worker:pane", "idle", 7);
	t.mock.timers.tick(1000);

	assert.equal(wakes.length, 1);
});

test("a wake asks GitHub nothing and carries no pull request line", (t) => {
	const { io, wakes, turn } = settles(t, REPORT);

	turn();

	assert.equal(io.calls.filter((c) => c[0] === "gh").length, 0);
	assert.doesNotMatch(wakes[0], /^pr:/m);
});

test("CLI watch follows the containers its pane owns, and named ones beside them", () => {
	const io = fakeIo({}, SEATS.claude);
	io.files["/home/me/.fleet/tasks/fleet-events.log"] = [
		"2026-09-16T10:00:00.000Z w1:host up claude-mine session=",
		"2026-09-16T10:01:00.000Z w2:other up claude-theirs session=",
		"2026-09-16T10:02:00.000Z w2:other up claude-named session=",
	].join("\n");

	assert.deepEqual(paneScope(io, [])(), ["claude-mine"]);
	assert.deepEqual(paneScope(io, ["claude-named"])(), [
		"claude-named",
		"claude-mine",
	]);
});

test("a container steered from another pane leaves the watch without a wake", (t: TestContext) => {
	const { io, intervals } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	const log = "/home/me/.fleet/tasks/fleet-events.log";
	io.files[log] = "2026-09-16T10:00:00.000Z w1:host up claude-worker session=";
	const wakes: string[] = [];
	watch(paneScope(io, []), io, (text) => wakes.push(text));

	io.files[log] +=
		'\n2026-09-16T10:01:00.000Z w2:other steer claude-worker session= "go"';
	intervals.get(30_000)?.();

	assert.deepEqual(wakes, []);
});

test("CLI watch outside a herdr pane follows only the containers it names", () => {
	const io = Object.assign(fakeIo({}, SEATS.claude), { pane: "-" });
	io.files["/home/me/.fleet/tasks/fleet-events.log"] =
		"2026-09-16T10:00:00.000Z - up claude-shell session=";

	assert.deepEqual(paneScope(io, [])(), []);
	assert.deepEqual(paneScope(io, ["claude-named"])(), ["claude-named"]);
});



