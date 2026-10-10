import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net from "node:net";
import { test, type TestContext } from "node:test";
import fleetMonitor from "../../extensions/fleet-monitor.ts";
import { KINDS, SEATS } from "../harness.ts";
import { SAMPLE_PROFILES } from "../profile/fixture.ts";
import {
	artifacts,
	copy,
	down,
	exec,
	fresh,
	ls,
	peek,
	renderHost,
	resolveSandbox,
	steer,
} from "./commands.ts";
import { EVENTS_LOG } from "./events.ts";
import { fakeIo } from "./fake-io.ts";
import { land } from "./land.ts";
import { permissions } from "./permissions.ts";
import { up } from "./up.ts";
import { paneScope, watch } from "./watch.ts";

const log = `/home/me/${EVENTS_LOG}`;
const listed = (name: string, agent: string) => ({
	"sbx ls --json": {
		sandboxes: [{ name, status: "running", workspaces: ["/r"], agent }],
	},
	"herdr agent list": {
		result: {
			agents: [
				{ name, pane_id: "w1:p2", tab_id: "w1:t2", agent_status: "working" },
			],
		},
	},
});
for (const seat of Object.values(SEATS))
	for (const kind of Object.values(KINDS)) {
		test(`a ${seat.name} seat steers a ${kind.name} container`, () => {
			const name = `${kind.prefix}a`;
			const io = fakeIo(listed(name, kind.name), seat);

			steer(resolveSandbox(name, io), "go", io);

			assert.ok(
				io.calls.some((c) =>
					c.join(" ").startsWith(`herdr agent prompt ${name} go`),
				),
			);
			assert.deepEqual(io.lines, [`${name}: steered`]);
			assert.ok(
				io.calls.some(
					(c) =>
						c[0] === "append" && c[1] === log && c[2].includes(` steer ${name} `),
				),
			);
		});

		test(`a ${seat.name} seat lists and takes down a ${kind.name} container`, () => {
			const name = `${kind.prefix}a`;
			const io = fakeIo(
				{ ...listed(name, kind.name), [`sbx exec ${name} sh -c`]: "task\t0\t" },
				seat,
			);

			assert.match(ls(io), new RegExp(`^${name} `));
			down(name, {}, io);

			assert.ok(io.calls.some((c) => c.join(" ") === `sbx rm -f ${name}`));
			assert.ok(
				io.calls.some(
					(c) =>
						c[0] === "append" && c[1] === log && c[2].includes(` down ${name} `),
				),
			);
		});
	}

const LINE = "Deliver issues/02-api.md";

function startingFresh(
	name: string,
	kind: (typeof KINDS)[keyof typeof KINDS],
	seat: (typeof SEATS)[keyof typeof SEATS],
	after = "idle",
) {
	const io = fakeIo(
		{
			...listed(name, kind.name),
			"herdr agent list": {
				result: {
					agents: [{ name, pane_id: "w1:p2", tab_id: "w1:t2", agent_status: after }],
				},
			},
		},
		seat,
	);
	const prompts = () =>
		io.calls
			.filter((c) => c[0] === "herdr" && c[2] === "prompt")
			.map((c) => c[4]);
	return { io, prompts };
}

for (const seat of Object.values(SEATS))
	for (const kind of Object.values(KINDS)) {
		const name = `${kind.prefix}a`;

		test(`a ${seat.name} seat starts a fresh ${kind.name} session with its own command, then sends the line`, async () => {
			const { io, prompts } = startingFresh(name, kind, seat);

			await fresh(resolveSandbox(name, io), LINE, io);

			assert.deepEqual(prompts(), [kind.tokens["fresh.command"], LINE]);
		});
	}

test("the pi command for a fresh session is /new and the claude one /clear", () => {
	assert.equal(KINDS.pi.tokens["fresh.command"], "/new");
	assert.equal(KINDS.claude.tokens["fresh.command"], "/clear");
});

test("the line waits until herdr reports the fresh session idle", async () => {
	const name = "claude-a";
	const { io, prompts } = startingFresh(name, KINDS.claude, SEATS.pi);
	const polls: string[] = ["working", "working", "idle"];
	const herdr = io.herdr;
	const order: string[] = [];
	io.herdr = ((args: string[]) => {
		order.push(args[1]);
		return args[1] === "list"
			? { result: { agents: [{ name, agent_status: polls.shift() }] } }
			: herdr(args);
	}) as typeof io.herdr;

	await fresh(resolveSandbox(name, io), LINE, io);

	assert.deepEqual(
		order.filter((call) => call === "prompt" || call === "list"),
		["prompt", "list", "list", "list", "prompt"],
	);
	assert.deepEqual(prompts(), ["/clear", LINE]);
});

test("the line also goes once herdr reports the fresh session done", async () => {
	const { io, prompts } = startingFresh("claude-a", KINDS.claude, SEATS.pi, "done");

	await fresh(resolveSandbox("claude-a", io), LINE, io);

	assert.deepEqual(prompts(), ["/clear", LINE]);
});

test("a fresh session says when the container's image predates the harness, once", async () => {
	const { io } = startingFresh("claude-a", KINDS.claude, SEATS.pi);
	Object.assign(io, {
		read: (
			(read) => (path: string) =>
				path.endsWith("cache/claude/image-stamp") ? "31e3d51\n" : read(path)
		)(io.read),
	});
	const git = io.git;
	io.git = (args, cwd) =>
		args.join(" ") === "log -1 --format=%h" ? "f7e7f1a" : git(args, cwd);

	await fresh(resolveSandbox("claude-a", io), LINE, io, "/root");

	assert.equal(
		io.lines.filter((line) =>
			line.includes("keeps its image until it goes down and up again"),
		).length,
		1,
	);
});

test("a container whose fresh session never turns idle fails naming the sandbox, and gets no line", async () => {
	const name = "claude-a";
	const { io, prompts } = startingFresh(name, KINDS.claude, SEATS.claude, "working");

	await assert.rejects(
		fresh(resolveSandbox(name, io), LINE, io),
		/claude-a: .*idle.*the line was not sent/,
	);
	assert.deepEqual(prompts(), ["/clear"]);
});

test("the kind comes from the agent sbx reports, whatever the name prefix says", () => {
	const io = fakeIo({
		"sbx ls --json": {
			sandboxes: [
				{
					name: "pi-runs-claude",
					status: "running",
					workspaces: ["/r"],
					agent: "claude",
				},
				{
					name: "claude-legacy",
					status: "running",
					workspaces: ["/r"],
					agent: "claude",
				},
				{
					name: "claude-runs-pi",
					status: "running",
					workspaces: ["/r"],
					agent: "pi",
				},
				{ name: "pi-codex", status: "running", workspaces: ["/r"], agent: "codex" },
			],
		},
	});

	assert.equal(resolveSandbox("pi-runs-claude", io).kind, KINDS.claude);
	assert.equal(resolveSandbox("claude-legacy", io).kind, KINDS.claude);
	assert.equal(resolveSandbox("claude-runs-pi", io).kind, KINDS.pi);
	assert.throws(
		() => resolveSandbox("pi-codex", io),
		/no fleet container named pi-codex/,
	);
});

test("a claude- container an earlier fleet put up is listed, steered and taken down from a pi seat", () => {
	const name = "claude-expenses-old";
	const io = fakeIo(
		{ ...listed(name, "claude"), [`sbx exec ${name} sh -c`]: "task\t0\t" },
		SEATS.pi,
	);

	assert.match(ls(io), new RegExp(`^${name} `));
	steer(resolveSandbox(name, io), "go", io);
	down(name, {}, io);

	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c[1] === "cp"));
	assert.ok(io.calls.some((c) => c.join(" ") === `sbx rm -f ${name}`));
});

const seatless = (answers: Record<string, unknown> = {}) =>
	Object.assign(fakeIo(answers), { seat: undefined });

test("up, steer, a fresh steer, watch and render require a seat, while profile --apply configures both hosts from a plain shell", async () => {
	const io = seatless({
		...listed("pi-a", "pi"),
		"read /root/host/repos.json": SAMPLE_PROFILES,
		"stat /r": { size: 0, mtime: new Date(0), dir: true },
		"git remote get-url origin": "git@github.com:acme/webapp.git",
		"git rev-parse --show-toplevel": "/r",
		"git rev-parse --path-format=absolute --git-path info/exclude":
			"/r/.git/info/exclude",
	});

	await assert.rejects(
		up({ repo: "/w/webapp", label: "web-1", root: "/root" }, io),
		/FLEET_SEAT/,
	);
	assert.throws(() => steer(resolveSandbox("pi-a", io), "go", io), /FLEET_SEAT/);
	await assert.rejects(
		fresh(resolveSandbox("pi-a", io), LINE, io),
		/FLEET_SEAT/,
	);
	assert.throws(() => watch(paneScope(io, []), io), /FLEET_SEAT/);
	assert.throws(() => renderHost("/root", io), /FLEET_SEAT/);
	const applied = permissions({ root: "/root", repo: "/r", apply: true }, io);
	assert.match(applied, /commit\.gpgsign .* -> false/);
	assert.ok(!io.calls.some((c) => c[0] === "run" || c[0] === "write"));
});

test("ls, peek, exec, copy, artifacts, land and down run without FLEET_SEAT", () => {
	const io = seatless({
		...listed("pi-a", "pi"),
		"read /root/host/repos.json": SAMPLE_PROFILES,
		"sbx exec pi-a sh -c": "task\t0\t",
		"git rev-parse --show-toplevel": "/r",
	});

	ls(io);
	peek("pi-a", io);
	exec("pi-a", ["true"], io);
	copy("pi-a:/x", "/y", io);
	artifacts("/r", io);
	land({ sandbox: "pi-a", repo: "/r", root: "/root" }, io);
	down("pi-a", {}, io);

	assert.ok(io.calls.some((c) => c.join(" ") === "sbx rm -f pi-a"));
});

function herdrSocket(t: TestContext) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	t.mock.method(
		globalThis,
		"setInterval",
		(() => 1) as unknown as typeof setInterval,
	);
	const sockets: EventEmitter[] = [];
	t.mock.method(net, "createConnection", () => {
		const socket = Object.assign(new EventEmitter(), {
			destroyed: false,
			write() {},
			destroy() {},
		});
		sockets.push(socket);
		return socket as unknown as net.Socket;
	});
	return () => {
		for (const socket of sockets)
			socket.emit(
				"data",
				Buffer.from(
					`${JSON.stringify({ event: "pane.agent_status_changed", data: { pane_id: "w1:p2", agent_status: "idle" } })}\n`,
				),
			);
		t.mock.timers.tick(1100);
	};
}

test("a claude seat's pane-owned watch wakes on a pi container it put up", (t) => {
	const settle = herdrSocket(t);
	const io = fakeIo(listed("pi-a", "pi"), SEATS.claude);
	io.files[log] = "2026-09-16T10:00:00.000Z w1:host up pi-a session=";
	const wakes: string[] = [];

	watch(paneScope(io, []), io, (text) => wakes.push(text));
	settle();

	assert.match(wakes[0] ?? "", /^\[fleet\] pi-a:/);
});

test("a pi seat's session-owned watch wakes on a claude container it put up", (t) => {
	const settle = herdrSocket(t);
	const io = fakeIo(listed("claude-a", "claude"), SEATS.pi);
	io.files[log] =
		"2026-09-16T10:00:00.000Z w9:other up claude-a session=session-a";
	const handlers: Record<string, (...args: any[]) => any> = {};
	const messages: string[] = [];
	fleetMonitor(
		SEATS.pi,
		io,
	)({
		on: (name: string, fn: any) => {
			handlers[name] = fn;
		},
		registerTool() {},
		registerCommand() {},
		sendMessage: (message: { content: string }) => messages.push(message.content),
	});
	t.after(() => handlers.session_shutdown());

	handlers.session_start(
		{},
		{ sessionManager: { getSessionId: () => "session-a" } },
	);
	settle();

	assert.match(messages[0] ?? "", /^\[fleet\] claude-a:/);
});
