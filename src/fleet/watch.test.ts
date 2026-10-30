import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { SEATS, KINDS } from "../harness.ts";
import { fakeIo } from "./fake-io.ts";
import { fleetAgents, jsonLines, sessionScope, wakeLines, wakeName, watch } from "./watch.ts";

const agents = [
	{ name: "claude-webapp-a", address: "t1", state: "working" },
	{ name: "claude-webapp-b", address: "t2", state: "idle" },
	{ name: "notes", address: "t3", state: "idle" },
];
const sandboxes = [
	{ name: "claude-webapp-a", agent: "claude", status: "running", workspaces: ["/w/webapp"] },
	{ name: "claude-webapp-b", agent: "claude", status: "running", workspaces: ["/w/webapp"] },
];

const REPORT = "Added the login rate limit; its tests pass at 9d290c9.";

function leaving(io: ReturnType<typeof fakeIo>) {
	const sbx = io.sbx;
	io.sbx = (args, opts) =>
		args.join(" ") === "ls --json" ? JSON.stringify([]) : sbx(args, opts);
}

type Live = { name: string; address: string; state: string; turn?: number; sandbox?: string };

function fleet(
	t: TestContext,
	agents: Live[],
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
	const io = fakeIo(
		{
			"sbx ls --json": agents.map((a) => ({
				name: a.name,
				agent: a.name.startsWith("pi-") ? "pi" : "claude",
				workspaces: ["/w/webapp"],
			})),
		},
		seat,
	);
	io.hc = <T>(args: string[]) => {
		io.calls.push(["hc", ...args]);
		return hcAnswer(agents, args) as T;
	};
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
	const send = (params: Record<string, unknown>) => {
		for (const follower of io.followers) if (!follower.stopped) follower.onLine(JSON.stringify({ jsonrpc: "2.0", method: "event", params }));
	};
	const states = new Map(agents.map((a) => [a.address, a.state]));
	const turns = new Map(agents.map((a) => [a.address, a.turn ?? 0]));
	const status = (terminal: string, next: string, turn?: number) => {
		send({ type: "status", terminal, data: { status: { state: next } } });
		const left = states.get(terminal) === "working" && next !== "working";
		states.set(terminal, next);
		if (turn === undefined && !left) return;
		turns.set(terminal, turn ?? (turns.get(terminal) ?? 0) + 1);
		send({ type: "turn", terminal, data: { state: next, turn: turns.get(terminal) } });
	};
	const exited = (terminal: string) => send({ type: "finished", terminal, data: { exit_code: 0 } });
	return { io, intervals, streams: io.followers, status, exited, said };
}

function hcAnswer(agents: Live[], args: string[]) {
	const terminals = terminalsOf(agents);
	if (args[0] === "get") return terminals.find((terminal) => terminal.address === args[1]);
	return { terminals: terminals.map(({ address, status, turn }) => ({ address, state: "live", status: status.state, turn })) };
}

function terminalsOf(agents: Live[]) {
	return agents.map((a) => ({ address: a.address, labels: { fleet: "1", "fleet.sandbox": a.sandbox ?? a.name }, status: { state: a.state }, turn: a.turn ?? 0 }));
}

test("a stopped container stays in the status line without waking or probing it", (t) => {
	const { io, status, intervals } = fleet(t, [agents[0]]);
	const sbx = io.sbx;
	io.sbx = (args, opts) => args[0] === "ls"
		? JSON.stringify([{ ...sandboxes[0], status: "stopped" }])
		: sbx(args, opts);
	const lines: string[] = [];
	const wakes: string[] = [];
	const handle = watch(() => undefined, io, (text) => wakes.push(text), (line) => lines.push(line));
	t.after(() => handle.stop());

	status("t1", "idle");
	t.mock.timers.tick(1000);
	intervals.get(60_000)?.();

	assert.equal(lines.at(-1), "claude-webapp-a stopped");
	assert.deepEqual(wakes, []);
	assert.equal(io.calls.filter((c) => c[0] === "sbx" && c[1] === "exec").length, 0);
});

test("a stopped container stays watched with no terminal at all", (t) => {
	const { io } = fleet(t, []);
	io.sbx = () => JSON.stringify([{ ...sandboxes[0], status: "stopped" }]);
	const lines: string[] = [];
	const handle = watch(() => undefined, io, () => {}, (line) => lines.push(line));
	t.after(() => handle.stop());

	handle.refresh();

	assert.equal(lines.at(-1), "claude-webapp-a stopped");
});

test("watch follows the harness's containers and nothing else hc runs", () => {
	const terminals = terminalsOf(agents);
	assert.deepEqual(
		fleetAgents(terminals, sandboxes, undefined).map((a) => a.name),
		["claude-webapp-a", "claude-webapp-b"],
	);
	assert.deepEqual(
		fleetAgents(terminals, sandboxes, ["claude-webapp-b"]).map((a) => a.name),
		["claude-webapp-b"],
	);
	assert.deepEqual(fleetAgents(terminals, sandboxes, []), []);
});

test("a long sandbox is followed under its shortened tab name", () => {
	const sandbox = "pi-webapp-bug-ledger-repost-status-bar";
	const other = "pi-webapp-web-1705-no-date-picker-for-import";
	const terminals = [
		{ address: "t1", labels: { fleet: "1", "fleet.sandbox": sandbox }, status: { state: "idle" } },
		{ address: "t2", labels: { fleet: "1", "fleet.sandbox": other }, status: { state: "idle" } },
	];
	const rows = [sandbox, other].map((name) => ({ name, status: "running" }));

	assert.deepEqual(fleetAgents(terminals, rows, [sandbox]), [{ name: sandbox, status: "idle", terminal: "t1", turn: undefined }]);
});

test("a wake names the sandbox and its state before the agent's last message", () => {
	const text = wakeLines("claude-household-budget-t01-skeleton", "idle", REPORT);
	assert.equal(text, `[fleet] claude-household-budget-t01-skeleton: idle\n\n${REPORT}`);
	assert.equal(wakeName(text), "claude-household-budget-t01-skeleton");
});

test("CLI watch reconciles status and reconnects after a closed stream", (t: TestContext) => {
	const agents = [
		{ name: "claude-webapp-a", address: "t1", state: "working" },
	];
	const { io, intervals, streams } = fleet(t, agents);
	let snapshots = 0;
	io.hc = <T>(args: string[]) => {
		if (args[0] === "ls") snapshots++;
		if (snapshots === 2) throw new Error("hc unavailable");
		return hcAnswer(agents, args) as T;
	};
	watch(() => undefined, io);

	agents[0].state = "idle";
	streams[0].onClose();
	t.mock.timers.tick(3000);
	t.mock.timers.tick(3000);
	t.mock.timers.tick(1000);

	assert.equal(streams.length, 2);
	assert.equal(
		io.lines.filter((line) => line.startsWith("[fleet] claude-webapp-a:"))
			.length,
		1,
	);
	assert.match(
		io.lines.at(-1) ?? "",
		/^\[fleet\] claude-webapp-a: idle\n\nAdded the login rate limit/,
	);

	agents[0].state = "done";
	intervals.get(30_000)?.();
	t.mock.timers.tick(1000);

	assert.equal(
		io.lines.filter((line) => line.startsWith("[fleet] claude-webapp-a:"))
			.length,
		1,
	);
});

test("a JSON watch prints each wake and each notice as one line a reader can split on newlines", (t: TestContext) => {
	const { io, status } = fleet(t, [
		{ name: "claude-webapp-a", address: "t1", state: "working" },
	]);
	const json = jsonLines(io);
	watch(() => undefined, json.io, json.onWake, json.onTracked);

	status("t1", "idle");
	t.mock.timers.tick(1100);

	const parsed = io.lines.map((line) => JSON.parse(line));
	assert.deepEqual(parsed[0], { watching: "claude-webapp-a working" });
	assert.match(parsed[1].log, /^\[fleet\] watching/);
	assert.match(parsed.at(-1).wake, /^\[fleet\] claude-webapp-a: idle\n\n/);
	assert.ok(io.lines.every((line) => !line.includes("\n")));
});

test("watch reports the containers it follows with each one's status as it changes", (t: TestContext) => {
	const { io, status } = fleet(t, [
		{ name: "claude-webapp-a", address: "t1", state: "working" },
		{ name: "pi-webapp-b", address: "t2", state: "idle" },
	]);
	const reports: string[] = [];

	watch(() => undefined, io, () => {}, (line) => reports.push(line));
	status("t1", "blocked");
	status("t1", "blocked");

	assert.deepEqual(reports, [
		"claude-webapp-a working · pi-webapp-b idle",
		"claude-webapp-a blocked · pi-webapp-b idle",
	]);
});

test("a transient idle between active turns does not wake the host", (t: TestContext) => {
	const { io, status } = fleet(t, [
		{ name: "claude-worker", address: "t20", state: "working" },
	]);
	const wakes: string[] = [];
	watch(
		() => undefined,
		io,
		(text) => wakes.push(text),
	);

	status("t20", "idle");
	status("t20", "working");
	t.mock.timers.tick(1100);

	assert.deepEqual(wakes, []);
});

test("different containers wake independently while an identical transition stays deduplicated", (t: TestContext) => {
	const { io, status } = fleet(t, [
		{ name: "claude-first", address: "t21", state: "working" },
		{ name: "claude-second", address: "t22", state: "working" },
	]);
	const wakes: string[] = [];
	watch(
		() => ["claude-first", "claude-second"],
		io,
		(text) => wakes.push(text),
	);

	for (const terminal of ["t21", "t21", "t22"]) {
		status(terminal, "idle");
		t.mock.timers.tick(1100);
	}

	assert.equal(wakes.length, 2);
	assert.match(wakes[0], /^\[fleet\] claude-first: idle\n\nAdded/);
	assert.match(wakes[1], /^\[fleet\] claude-second: idle\n\nAdded/);
	assert.doesNotMatch(wakes[0], /claude-second/);
});

test("an empty scope asks hc and sbx nothing", (t: TestContext) => {
	const { io, intervals } = fleet(t, [
		{ name: "claude-worker", address: "t20", state: "working" },
	]);

	watch(() => [], io);
	intervals.get(30_000)?.();

	assert.deepEqual(io.calls, []);
});

test("a watch with nothing to follow says how to follow a container this session did not put up, start or steer", (t: TestContext) => {
	const { io } = fleet(t, []);

	watch(() => [], io);

	assert.deepEqual(io.lines, [
		"[fleet] watching nothing yet; fleet up adds containers within 30s, and fleet watch <sandbox> follows one this session did not put up, start or steer",
	]);
});

test("a stopped watch neither refreshes nor reconnects", (t: TestContext) => {
	const { io, intervals, streams } = fleet(t, [
		{ name: "claude-worker", address: "t20", state: "working" },
	]);
	const stop = watch(() => undefined, io).stop;
	const asked = io.calls.length;

	stop();
	streams[0].onClose();
	t.mock.timers.tick(3000);
	intervals.get(30_000)?.();

	assert.equal(streams.length, 1);
	assert.ok(streams[0].stopped);
	assert.equal(io.calls.length, asked);
});

for (const h of Object.values(SEATS)) {
	test(`the ${h.name} watch follows hc's events for every fleet terminal`, (t: TestContext) => {
		const { io, streams } = fleet(
			t,
			[
				{
					name: `${KINDS[h.name].prefix}webapp-a`,
					address: "t1",
					state: "working",
				},
			],
			h,
		);
		watch(() => undefined, io);

		assert.deepEqual(streams.map((f) => f.args), [["hc", "events", "--label", "fleet=1", "--json"]]);
	});
}

test("a steer since the last wake lets the next settle wake the host again", (t: TestContext) => {
	const { io, status } = fleet(t, [
		{ name: "claude-worker", address: "t20", state: "working" },
	]);
	const wakes: string[] = [];
	watch(
		() => undefined,
		io,
		(text) => wakes.push(text),
	);

	status("t20", "idle");
	t.mock.timers.tick(1100);
	io.files["/home/me/.fleet/tasks/fleet-events.log"] =
		'2026-09-16T10:05:00.000Z t30 steer claude-worker session= "go on"\n';
	status("t20", "working");
	status("t20", "idle");
	t.mock.timers.tick(1100);

	assert.equal(wakes.length, 2);
});

test("a container a down closes wakes once as taken down, never with its last settle or its exit", (t: TestContext) => {
	const { io, status, exited } = fleet(t, [
		{ name: "claude-worker", address: "t20", state: "working" },
	]);
	const wakes: string[] = [];
	watch(
		() => undefined,
		io,
		(text) => wakes.push(text),
	);

	io.files["/home/me/.fleet/tasks/fleet-events.log"] =
		"2026-09-16T10:05:00.000Z t31 down claude-worker session=\n";
	status("t20", "idle");
	t.mock.timers.tick(1100);
	exited("t20");

	assert.equal(wakes.length, 1);
	assert.match(wakes[0], /^\[fleet\] claude-worker: idle -> taken down$/);
});

test("a container this session takes down wakes nobody", (t: TestContext) => {
	const { io, status, exited } = fleet(t, [
		{ name: "claude-worker", address: "t20", state: "working" },
	]);
	io.sessionId = "host-a";
	const wakes: string[] = [];
	watch(
		() => undefined,
		io,
		(text) => wakes.push(text),
	);

	io.files["/home/me/.fleet/tasks/fleet-events.log"] =
		"2026-09-16T10:05:00.000Z t30 down claude-worker session=host-a\n";
	status("t20", "idle");
	t.mock.timers.tick(1100);
	exited("t20");

	assert.deepEqual(wakes, []);
});

test("a watched container whose sandbox leaves the list wakes once as taken down while its terminal stays", (t: TestContext) => {
	const { io, intervals } = fleet(t, [
		{ name: "claude-worker", address: "t20", state: "idle" },
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
	const { io } = fleet(t, [
		{ name: "claude-worker", address: "t20", state: "working" },
	]);
	io.hc = (() => {
		throw new Error("sbx ls --json failed (1) docker hub refresh lock held");
	}) as typeof io.hc;
	watch(() => undefined, io);

	t.mock.timers.tick(3000);
	t.mock.timers.tick(3000);

	assert.equal(
		io.lines.filter((line) => line.includes("refresh lock")).length,
		1,
	);
});

test("a sandbox listing that fails the same way on every wake logs it once", (t: TestContext) => {
	const { io, status } = fleet(t, [
		{ name: "claude-worker", address: "t20", state: "working" },
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

	status("t20", "blocked");
	status("t20", "working");
	status("t20", "blocked");

	assert.equal(wakes.length, 2);
	assert.equal(
		io.lines.filter((line) => line.includes("docker daemon failed")).length,
		1,
	);
});

function settles(t: TestContext, message: string) {
	const fixture = fleet(t, [
		{ name: "claude-worker", address: "t20", state: "working" },
	]);
	fixture.said["claude-worker"] = message;
	const wakes: string[] = [];
	const handle = watch(() => undefined, fixture.io, (text) => wakes.push(text));
	t.after(() => handle.stop());
	const turn = (seq?: number) => {
		fixture.status("t20", "working");
		fixture.status("t20", "idle", seq);
		t.mock.timers.tick(1000);
	};
	return { ...fixture, wakes, turn };
}

test("a settle wakes the host with its state and the agent's last message", (t) => {
	const message = "Added the column.\n\nOpen questions:\n- Which route?";
	const { io, wakes, turn } = settles(t, message);

	turn();

	assert.deepEqual(wakes, [`[fleet] claude-worker: idle\n\n${message}`]);
	assert.equal(io.calls.filter((c) => c[0] === "hc" && c[1] === "read").length, 0);
});

test("a pi container wakes the host with the last message of its own session", (t) => {
	const { io, said, status } = fleet(t, [{ name: "pi-worker", address: "t20", state: "working" }], SEATS.pi);
	said["pi-worker"] = "Checked the trace; nothing to change.";
	const wakes: string[] = [];
	const handle = watch(() => undefined, io, (text) => wakes.push(text));
	t.after(() => handle.stop());

	status("t20", "idle");
	t.mock.timers.tick(1000);

	assert.deepEqual(wakes, ["[fleet] pi-worker: idle\n\nChecked the trace; nothing to change."]);
});

test("a turn that ends in an error wakes the host with the error the agent last wrote", (t) => {
	const { io, said, status } = fleet(t, [{ name: "pi-worker", address: "t20", state: "working" }], SEATS.pi);
	said["pi-worker"] = "429 rate limit reached; not retried.";
	const wakes: string[] = [];
	const handle = watch(() => undefined, io, (text) => wakes.push(text));
	t.after(() => handle.stop());

	status("t20", "error");
	t.mock.timers.tick(1000);

	assert.deepEqual(wakes, ["[fleet] pi-worker: error\n\n429 rate limit reached; not retried."]);
});

test("a settle that says nothing new since the last wake, as after compacting while idle, wakes nobody", (t) => {
	const { wakes, turn } = settles(t, REPORT);

	turn();
	turn();

	assert.deepEqual(wakes, [`[fleet] claude-worker: idle\n\n${REPORT}`]);
});

test("a done after an idle with the same message wakes nobody", (t) => {
	const { wakes, turn, status } = settles(t, REPORT);

	turn();
	status("t20", "working");
	status("t20", "done");
	t.mock.timers.tick(1000);

	assert.equal(wakes.length, 1);
});

test("a second dialog wakes the host even when the agent said nothing new", (t) => {
	const { wakes, status } = settles(t, REPORT);

	status("t20", "blocked");
	status("t20", "working");
	status("t20", "blocked");

	assert.equal(wakes.length, 2);
});

test("a steer lets the same message wake the host again", (t) => {
	const { io, wakes, turn } = settles(t, REPORT);

	turn();
	io.files["/home/me/.fleet/tasks/fleet-events.log"] =
		'2099-01-01T00:00:00.000Z t30 steer claude-worker session= "go on"\n';
	turn();

	assert.equal(wakes.length, 2);
});

test("every settle with a new message wakes the host, with or without a steer between them", (t) => {
	const { said, wakes, turn } = settles(t, "Waiting on the typecheck.");

	turn();
	said["claude-worker"] = "Typecheck green; waiting on the e2e run.";
	turn();
	said["claude-worker"] = "Done: PR #12 needs a push.";
	turn();

	assert.equal(wakes.length, 3);
	assert.match(wakes[2], /PR #12 needs a push/);
});

function works(t: TestContext) {
	let clock = Date.UTC(2026, 9, 20, 9, 0);
	t.mock.method(Date, "now", () => clock);
	const fixture = fleet(t, [
		{ name: "claude-worker", address: "t20", state: "working" },
	]);
	const wakes: string[] = [];
	const handle = watch(() => undefined, fixture.io, (text) => wakes.push(text));
	t.after(() => handle.stop());
	const minutes = (count: number) => {
		for (let i = 0; i < count; i++) {
			clock += 60_000;
			fixture.intervals.get(60_000)?.();
		}
	};
	const sleep = (ms: number) => {
		clock += ms;
	};
	return { ...fixture, wakes, minutes, sleep };
}

test("a container no wake has reached yet wakes the host after 20 minutes of work, with how long it has worked", (t) => {
	const { wakes, minutes } = works(t);

	minutes(20);

	assert.deepEqual(wakes, [`[fleet] claude-worker: working 20m without settling\n\n${REPORT}`]);
});

test("a container that said nothing new since its last wake wakes the host after 20 minutes of work", (t) => {
	const { status, wakes, minutes } = works(t);

	status("t20", "idle");
	t.mock.timers.tick(1000);
	status("t20", "working");
	minutes(20);

	assert.equal(wakes.length, 2);
	assert.match(wakes[1], /working 20m without settling/);
});

test("a container whose last message moves on keeps working without waking the host", (t) => {
	const { said, wakes, minutes } = works(t);

	minutes(20);
	said["claude-worker"] = "Unit tests green; starting the e2e run.";
	minutes(15);
	const moving = wakes.length;
	minutes(15);

	assert.equal(moving, 1);
	assert.equal(wakes.length, 2);
	assert.match(wakes[1], /working 50m without settling/);
});

test("a container that said something new since its last wake works on without waking the host", (t) => {
	const { said, status, wakes, minutes } = works(t);

	status("t20", "idle");
	t.mock.timers.tick(1000);
	status("t20", "working");
	said["claude-worker"] = "Steered: rebasing onto main.";
	minutes(20);

	assert.equal(wakes.length, 1);
});

test("a sleep of the Mac wakes the host once and does not count as working time", (t) => {
	const { wakes, minutes, sleep } = works(t);

	minutes(5);
	sleep(3 * 60 * 60_000);
	minutes(1);
	const afterSleep = [...wakes];
	minutes(13);
	const beforeStall = wakes.length;
	minutes(1);

	assert.equal(afterSleep.length, 1);
	assert.match(afterSleep[0], /^\[fleet\] watch: this Mac slept from \d\d:\d\d to \d\d:\d\d while claude-worker worked;/);
	assert.equal(beforeStall, 1);
	assert.match(wakes[1], /working 20m without settling/);
});

test("a container that starts working after the Mac wakes counts its work from then", (t) => {
	const { status, wakes, minutes, sleep } = works(t);

	status("t20", "idle");
	t.mock.timers.tick(1000);
	sleep(3 * 60 * 60_000);
	status("t20", "working");
	minutes(20);

	assert.equal(wakes.length, 2);
	assert.match(wakes[1], /working 20m without settling/);
});

test("a settle hc reports again within the same turn wakes once", (t) => {
	const { wakes, status } = settles(t, REPORT);

	status("t20", "idle", 7);
	t.mock.timers.tick(1000);
	status("t20", "unknown", 7);
	status("t20", "idle", 7);
	t.mock.timers.tick(1000);

	assert.equal(wakes.length, 1);
});

test("a wake asks GitHub nothing and carries no pull request line", (t) => {
	const { io, wakes, turn } = settles(t, REPORT);

	turn();

	assert.equal(io.calls.filter((c) => c[0] === "gh").length, 0);
	assert.doesNotMatch(wakes[0], /^pr:/m);
});

test("CLI watch outside Herdr app follows the containers its session put up, started or steered, and named ones beside them", () => {
	const io = Object.assign(fakeIo({}, SEATS.claude), { terminal: "-", sessionId: "s1" });
	io.files["/home/me/.fleet/tasks/fleet-events.log"] = [
		"2026-09-16T10:00:00.000Z - up claude-mine session=s1",
		"2026-09-16T10:01:00.000Z - up claude-theirs session=s2",
		"2026-09-16T10:02:00.000Z - start claude-started session=s1",
		'2026-09-16T10:03:00.000Z - steer claude-steered session=s1 "go"',
		"2026-09-16T10:04:00.000Z - up claude-named session=s2",
	].join("\n");

	assert.deepEqual(sessionScope(io, ["claude-named"])(), [
		"claude-named",
		"claude-mine",
		"claude-started",
		"claude-steered",
	]);
});

test("a container a session put up outside Herdr app wakes that session when it settles, and another's does not", (t: TestContext) => {
	const { io, status } = fleet(t, [
		{ name: "claude-mine", address: "t23", state: "working" },
		{ name: "claude-theirs", address: "t24", state: "working" },
	]);
	Object.assign(io, { terminal: "-", sessionId: "s1" });
	io.files["/home/me/.fleet/tasks/fleet-events.log"] = [
		"2026-09-16T10:00:00.000Z - up claude-mine session=s1",
		"2026-09-16T10:01:00.000Z - up claude-theirs session=s2",
	].join("\n");
	const wakes: string[] = [];
	const handle = watch(sessionScope(io, []), io, (text) => wakes.push(text));
	t.after(() => handle.stop());

	status("t23", "idle");
	status("t24", "idle");
	t.mock.timers.tick(1000);

	assert.deepEqual(wakes, [`[fleet] claude-mine: idle\n\n${REPORT}`]);
});

test("CLI watch with no session follows only the containers it names", () => {
	const io = Object.assign(fakeIo({}, SEATS.claude), { terminal: "t30" });
	io.files["/home/me/.fleet/tasks/fleet-events.log"] =
		"2026-09-16T10:00:00.000Z t30 up claude-own session=";

	assert.deepEqual(sessionScope(io, [])(), []);
	assert.deepEqual(sessionScope(io, ["claude-named"])(), ["claude-named"]);
});



