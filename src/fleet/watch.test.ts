import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net from "node:net";
import { test, type TestContext } from "node:test";
import { CONTINUE, HARNESSES } from "../harness.ts";
import { fakeIo } from "./fake-io.ts";
import { agentName } from "./name.ts";
import { commitsProbe } from "./status.ts";
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

test("a watch with nothing to follow says how to follow a container this pane did not start", (t: TestContext) => {
	const { io } = herdr(t, []);

	watch(() => [], io);

	assert.deepEqual(io.lines, [
		"[fleet] watching nothing yet; cfleet up adds containers within 30s, and cfleet watch <sandbox> follows one this pane did not start",
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

test("a sandbox listing that fails the same way on every wake logs it once", (t: TestContext) => {
	const { io, status } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	const wakes: string[] = [];
	watch(() => undefined, io, (text) => wakes.push(text));
	const listed = io.sbx;
	io.sbx = ((args: string[], opts) => {
		if (args[0] === "ls") throw new Error("sbx ls --json failed (1)\ndocker daemon failed to start inside the sandbox");
		return listed(args, opts);
	}) as typeof io.sbx;

	status("worker:pane", "blocked");
	status("worker:pane", "working");
	status("worker:pane", "blocked");

	assert.equal(wakes.length, 2);
	assert.equal(io.lines.filter((line) => line.includes("docker daemon failed")).length, 1);
});

function limited(t: TestContext, pane: string, stoppedAt: Date, agent_status = "idle") {
	const fixture = herdr(t, [{ name: "claude-worker", pane_id: "worker:pane", agent_status }]);
	const { io } = fixture;
	const dir = "/home/me/.sandboxes/webapp/claude-worker";
	const events = "/home/me/.claude/fleet-cache/fleet-events.log";
	io.files[`${dir}/status.md`] = "status: blocked\nattention: the agent stopped on an error: rate_limit\n";
	const stat = io.stat;
	io.stat = (path) => (path === `${dir}/status.md` ? { size: 1, mtime: stoppedAt, dir: false } : stat(path));
	const herdrText = io.herdrText;
	io.herdrText = (args) => (args[1] === "read" ? pane : herdrText(args));
	io.append = (path, line) => {
		io.files[path] = `${io.files[path] ?? ""}${line}\n`;
	};
	let now = stoppedAt;
	io.now = () => now;
	const resumes = () => io.calls.filter((c) => c[0] === "herdr" && c[2] === "prompt" && c[4] === CONTINUE).length;
	const at = (minutes: number) => {
		now = new Date(stoppedAt.getTime() + minutes * 60_000);
		fixture.intervals.get(60_000)?.();
		return resumes();
	};
	return { ...fixture, events, at, dir };
}

test("a container stopped by the account limit resumes with the stock continue at the reset time its message gives", (t: TestContext) => {
	const stoppedAt = new Date(2026, 8, 16, 21, 40);
	const { io, at } = limited(t, "You've hit your session limit · resets 11:10pm", stoppedAt);
	watch(() => undefined, io, () => {});

	assert.equal(at(89), 0);
	assert.equal(at(90), 1);
	assert.equal(at(91), 1);
});

test("with no reset time the watch retries the continue every 30 minutes and gives up after 10 with one wake", (t: TestContext) => {
	const stoppedAt = new Date(2026, 8, 16, 21, 40);
	const { io, at } = limited(t, "API Error: rate_limit", stoppedAt);
	const wakes: string[] = [];
	watch(() => undefined, io, (text) => wakes.push(text));

	assert.equal(at(29), 0);
	assert.equal(at(30), 1);
	assert.equal(at(59), 1);
	for (let n = 2; n <= 10; n++) assert.equal(at(30 * n), n);
	assert.equal(at(330), 10);
	assert.equal(at(331), 10);
	assert.equal(at(400), 10);
	assert.equal(wakes.filter((w) => /account limit/.test(w)).length, 1);
	assert.match(wakes.at(-1) ?? "", /^\[fleet\] claude-worker: stopped on the account limit, 10 resumes did not take/);
});

test("the watch never sends the continue to a container that is working or waits on a dialog", async (t: TestContext) => {
	for (const state of ["working", "blocked", "unknown"])
		await t.test(state, (st: TestContext) => {
			const { io, at } = limited(st, "API Error: rate_limit", new Date(2026, 8, 16, 21, 40), state);
			watch(() => undefined, io, () => {});
			assert.equal(at(120), 0);
		});
});

test("a resume the container took, shown by a tool call after it, ends the retries", (t: TestContext) => {
	const stoppedAt = new Date(2026, 8, 16, 21, 40);
	const { io, at, dir } = limited(t, "API Error: rate_limit", stoppedAt);
	const wakes: string[] = [];
	watch(() => undefined, io, (text) => wakes.push(text));

	assert.equal(at(30), 1);
	io.files[`${dir}/logs/activity.jsonl`] = JSON.stringify({ at: new Date(stoppedAt.getTime() + 31 * 60_000).toISOString(), tool: "Bash", ok: true, agent: "main" });
	assert.equal(at(60), 1);
	assert.equal(at(400), 1);
	assert.deepEqual(wakes, []);
});

test("a restarted watch counts the resumes already sent", (t: TestContext) => {
	const stoppedAt = new Date(2026, 8, 16, 21, 40);
	const { io, at, events } = limited(t, "API Error: rate_limit", stoppedAt);
	const sent = (minutes: number) => `${new Date(stoppedAt.getTime() + minutes * 60_000).toISOString()} w1:host steer claude-worker session= ${JSON.stringify(CONTINUE)}`;
	io.files[events] = `${[sent(30), sent(60), sent(90)].join("\n")}\n`;
	watch(() => undefined, io, () => {});

	assert.equal(at(119), 0);
	assert.equal(at(120), 1);
});

test("a wake counts the tool calls a container made after status.md turned blocked", (t: TestContext) => {
	const { io, status } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	const dir = "/home/me/.sandboxes/webapp/claude-worker";
	const call = (at: string) => JSON.stringify({ at, tool: "Bash", ok: true, agent: "main" });
	io.files[`${dir}/status.md`] = "status: blocked\nattention: owner decision\n";
	io.files[`${dir}/logs/status/001-20260916T093000Z.md`] = "status: blocked\nattention: owner decision\n";
	io.files[`${dir}/logs/activity.jsonl`] = [call("2026-09-16T09:20:00Z"), call("2026-09-16T09:45:00Z")].join("\n");
	io.list = (path: string) => (path === `${dir}/logs/status` ? ["001-20260916T093000Z.md"] : []);
	const wakes: string[] = [];
	watch(() => undefined, io, (text) => wakes.push(text));

	status("worker:pane", "blocked");

	assert.match(wakes[0], /\n\nstatus: blocked\n/);
	assert.match(wakes[0], /\n\nstill working while blocked: 1 tool call since status\.md turned blocked(\n|$)/);
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

const PR_VIEW = "pr view task --json number,state,statusCheckRollup";

function onBranch(io: ReturnType<typeof fakeIo>, checks: unknown[]) {
	const sbx = io.sbx;
	io.sbx = (args, opts) =>
		args.join(" ") === `exec claude-worker sh -c ${commitsProbe}`
			? "task\torigin/main\t2\t1\t 2 files changed, 5 insertions(+)\tabc1234 add two"
			: sbx(args, opts);
	io.gh = (args, cwd) => {
		io.calls.push(["gh", cwd, ...args]);
		return JSON.stringify({ number: 12, state: "OPEN", statusCheckRollup: checks });
	};
}

test("a turn that ends with a PR open and CI running wakes nobody; the settle after CI ends wakes with the facts", (t: TestContext) => {
	const { io, status } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	io.files["/home/me/.sandboxes/webapp/claude-worker/status.md"] = "status: ready-for-host\nattention: none\n";
	onBranch(io, [
		{ __typename: "CheckRun", name: "test", status: "IN_PROGRESS", conclusion: "" },
		{ __typename: "StatusContext", context: "lint", state: "SUCCESS" },
	]);
	const wakes: string[] = [];
	watch(() => undefined, io, (text) => wakes.push(text));

	status("worker:pane", "idle");
	t.mock.timers.tick(1100);
	const whileRunning = wakes.length;
	onBranch(io, [
		{ __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "FAILURE" },
		{ __typename: "StatusContext", context: "lint", state: "SUCCESS" },
	]);
	status("worker:pane", "working");
	status("worker:pane", "idle");
	t.mock.timers.tick(1100);

	assert.equal(whileRunning, 0);
	assert.equal(wakes.length, 1);
	assert.match(wakes[0], /\n\ncommits: 2 since origin\/main, 1 pushed, 1 unpushed, 2 files \+5 -0, latest abc1234 add two\n\npr: #12 open, CI failed: test/);
	assert.ok(io.calls.some((call) => call.join(" ") === `gh /w/webapp ${PR_VIEW}`));
});

test("a branch with no pull request says so in its wake", (t: TestContext) => {
	const { io, status } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	onBranch(io, []);
	io.gh = () => {
		throw new Error('gh pr view task failed (1)\nno pull requests found for branch "task"');
	};
	const wakes: string[] = [];
	watch(() => undefined, io, (text) => wakes.push(text));

	status("worker:pane", "idle");
	t.mock.timers.tick(1100);

	assert.match(wakes[0], /\n\npr: none$|\n\npr: none\n/);
});

test("an idle container past the threshold without ready-for-host or blocked wakes once as stalled", (t: TestContext) => {
	const { io, intervals } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "idle" },
		{ name: "claude-done", pane_id: "done:pane", agent_status: "idle" },
	]);
	io.files["/home/me/.sandboxes/webapp/claude-worker/status.md"] = "status: implementing\nattention: none\n";
	io.files["/home/me/.sandboxes/webapp/claude-done/status.md"] = "status: ready-for-host\nattention: none\n";
	const start = Date.now();
	const clock = t.mock.method(Date, "now", () => start);
	const wakes: string[] = [];
	watch(() => undefined, io, (text) => wakes.push(text));

	clock.mock.mockImplementation(() => start + 19 * 60_000);
	intervals.get(60_000)?.();
	const early = wakes.length;
	clock.mock.mockImplementation(() => start + 21 * 60_000);
	intervals.get(60_000)?.();
	clock.mock.mockImplementation(() => start + 60 * 60_000);
	intervals.get(60_000)?.();

	assert.equal(early, 0);
	assert.equal(wakes.length, 1);
	assert.match(wakes[0], /^\[fleet\] claude-worker: idle 21m at implementing, stalled\n\nstatus: implementing/);
});

test("a blocked container wakes the host even while its PR's CI runs", (t: TestContext) => {
	const { io, status } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	io.files["/home/me/.sandboxes/webapp/claude-worker/status.md"] = "status: blocked\nattention: CI hangs past the wait\n";
	onBranch(io, [{ __typename: "CheckRun", name: "test", status: "IN_PROGRESS", conclusion: "" }]);
	const wakes: string[] = [];
	watch(() => undefined, io, (text) => wakes.push(text));

	status("worker:pane", "idle");
	t.mock.timers.tick(1100);

	assert.equal(wakes.length, 1);
	assert.match(wakes[0], /pr: #12 open, CI running, 0 of 1 checks done/);
});

test("a container paused at its step's end wakes the host even while its PR's CI runs", (t: TestContext) => {
	const { io, status } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	io.files["/home/me/.sandboxes/webapp/claude-worker/status.md"] = "status: paused\nattention: none\n";
	onBranch(io, [{ __typename: "CheckRun", name: "test", status: "IN_PROGRESS", conclusion: "" }]);
	const wakes: string[] = [];
	watch(() => undefined, io, (text) => wakes.push(text));

	status("worker:pane", "idle");
	t.mock.timers.tick(1100);

	assert.equal(wakes.length, 1);
	assert.match(wakes[0], /status: paused/);
});

test("a settle with status.md unchanged but new branch facts wakes the host again", (t: TestContext) => {
	const { io, status } = herdr(t, [
		{ name: "claude-worker", pane_id: "worker:pane", agent_status: "working" },
	]);
	io.files["/home/me/.sandboxes/webapp/claude-worker/status.md"] = "status: implementing\nattention: none\n";
	onBranch(io, []);
	const wakes: string[] = [];
	watch(() => undefined, io, (text) => wakes.push(text));

	status("worker:pane", "idle");
	t.mock.timers.tick(1100);
	const sbx = io.sbx;
	io.sbx = (args, opts) =>
		args.join(" ") === `exec claude-worker sh -c ${commitsProbe}`
			? "task\torigin/main\t3\t2\t 3 files changed, 9 insertions(+)\tdef5678 add three"
			: sbx(args, opts);
	status("worker:pane", "working");
	status("worker:pane", "idle");
	t.mock.timers.tick(1100);

	assert.equal(wakes.length, 2);
	assert.match(wakes[1], /commits: 3 since origin\/main/);
});
