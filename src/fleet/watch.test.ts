import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net from "node:net";
import { test, type TestContext } from "node:test";
import { HARNESSES } from "../harness.ts";
import { fakeIo } from "./fake-io.ts";
import { fleetAgents, wakeLines, watch } from "./watch.ts";

const agents = [
	{ name: "webapp-a", pane_id: "w1:p1", agent_status: "working" },
	{ name: "webapp-b", pane_id: "w1:p2", agent_status: "idle" },
	{ name: "notes", pane_id: "w1:p3", agent_status: "idle" },
];
const sandboxes = [
	{ name: "claude-webapp-a", workspaces: ["/w/webapp"] },
	{ name: "claude-webapp-b", workspaces: ["/w/webapp"] },
];

test("watch follows the harness's containers and nothing else in herdr", () => {
	assert.deepEqual(fleetAgents(agents, sandboxes, []).map((a) => a.name), ["webapp-a", "webapp-b"]);
	assert.deepEqual(fleetAgents(agents, sandboxes, ["claude-webapp-b"]).map((a) => a.name), ["webapp-b"]);
});

test("a wake names the agent and its change before the status.md projection", () => {
	assert.equal(wakeLines("webapp-a", "working -> idle", "status: ready-for-host"), "[fleet] webapp-a: working -> idle\nstatus: ready-for-host");
});

test("CLI watch reconciles status and reconnects after a closed stream", (t: TestContext) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const intervals = new Map<number, () => void>();
	t.mock.method(globalThis, "setInterval", ((callback: () => void, delay: number) => {
		intervals.set(delay, callback);
		return 1;
	}) as typeof setInterval);
	const sockets: (EventEmitter & { destroyed: boolean })[] = [];
	t.mock.method(net, "createConnection", () => {
		const socket = Object.assign(new EventEmitter(), {
			destroyed: false,
			write() {},
			destroy() { this.destroyed = true; },
		});
		sockets.push(socket);
		return socket as unknown as net.Socket;
	});
	const agents = [{ name: "webapp-a", pane_id: "w1:p1", agent_status: "working" }];
	const io = fakeIo({
		"sbx ls --json": { sandboxes: [{ name: "claude-webapp-a", workspaces: ["/w/webapp"] }] },
	}, HARNESSES.claude);
	let snapshots = 0;
	io.herdr = (<T>() => {
		snapshots++;
		if (snapshots === 2) throw new Error("herdr unavailable");
		return { result: { agents } } as T;
	});
	void watch([], io, "/tmp/herdr.sock");

	agents[0].agent_status = "idle";
	sockets[0].destroyed = true;
	sockets[0].emit("close");
	t.mock.timers.tick(3000);
	t.mock.timers.tick(3000);
	t.mock.timers.tick(1000);

	assert.equal(sockets.length, 2);
	assert.equal(io.lines.filter((line) => line.startsWith("[fleet] webapp-a:")).length, 1);
	assert.match(io.lines.at(-1) ?? "", /^\[fleet\] webapp-a: working -> idle\n/);

	agents[0].agent_status = "done";
	intervals.get(30_000)?.();
	t.mock.timers.tick(1000);

	assert.equal(io.lines.filter((line) => line.startsWith("[fleet] webapp-a:")).length, 1);
});
