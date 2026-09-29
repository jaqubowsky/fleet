import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { HARNESSES } from "../harness.ts";
import { fakeIo } from "./fake-io.ts";
import { relay } from "./relay.ts";

const TASK = "/home/me/.sandboxes/webapp/pi-webapp-a";
const STATE = `${TASK}/logs/agent-state.json`;

function running(t: TestContext) {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const io = fakeIo({}, HARNESSES.pi);
	const launched: string[][] = [];
	let finish: (code: number) => void = () => {};
	io.launch = (command, args) => {
		launched.push([command, ...args]);
		return new Promise((resolve) => {
			finish = resolve;
		});
	};
	const exited = relay("pi-webapp-a", TASK, ["--approve", "-c"], io);
	const report = (state: unknown) => {
		io.files[STATE] = JSON.stringify(state);
		t.mock.timers.tick(500);
	};
	const reports = () => io.calls.filter((c) => c[0] === "herdr" && c[1] === "pane" && c[2] === "report-agent").map((c) => c.slice(3));
	return { io, launched, exited, report, reports, finish: (code: number) => finish(code) };
}

test("each new state the container reports reaches herdr for the relay's own pane", async (t: TestContext) => {
	const agent = running(t);

	agent.report({ state: "working", seq: 7 });
	agent.report({ state: "idle", seq: 8 });
	t.mock.timers.tick(500);
	agent.finish(0);
	await agent.exited;

	assert.deepEqual(agent.reports(), [
		["w1:host", "--source", "fleet:pi", "--agent", "pi", "--state", "working", "--seq", "7"],
		["w1:host", "--source", "fleet:pi", "--agent", "pi", "--state", "idle", "--seq", "8"],
	]);
});

test("the container can set nothing in herdr but its pane's state, message and seq", async (t: TestContext) => {
	const agent = running(t);

	agent.report({ pane_id: "w9:p9", source: "herdr:claude", agent: "claude", state: "blocked", message: "--agent=claude", seq: 9 });
	agent.report({ state: "exited", seq: 10 });
	agent.report({ state: "working", seq: "11 --agent claude" });
	agent.report(null);
	agent.finish(0);
	await agent.exited;

	assert.deepEqual(agent.reports(), [
		["w1:host", "--source", "fleet:pi", "--agent", "pi", "--state", "blocked", "--seq", "9", "--message=--agent=claude"],
	]);
});

test("the agent runs with herdr's variables pointed inside the container, and the relay ends with its exit code", async (t: TestContext) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const io = fakeIo({}, HARNESSES.pi);
	io.files[STATE] = JSON.stringify({ state: "working", seq: 1 });
	const launched: string[][] = [];
	io.launch = async (command, args) => {
		launched.push([command, ...args]);
		return 3;
	};

	const code = await relay("pi-webapp-a", TASK, ["--approve", "-c"], io);
	io.files[STATE] = JSON.stringify({ state: "idle", seq: 2 });
	t.mock.timers.tick(1000);

	assert.equal(code, 3);
	assert.deepEqual(launched, [
		["sbx", "run", "--name", "pi-webapp-a", "-e", "HERDR_ENV=1", "-e", "HERDR_PANE_ID=w1:host", "-e", "HERDR_SOCKET_PATH=/tmp/herdr.sock", "-e", `FLEET_AGENT_STATE=${STATE}`, "--", "--approve", "-c"],
	]);
	assert.ok(io.calls.some((c) => c[0] === "remove" && c[1] === STATE));
	assert.deepEqual(io.calls.filter((c) => c[1] === "pane"), []);
});

test("a report herdr refuses goes again on the next read", async (t: TestContext) => {
	const agent = running(t);
	const answer = agent.io.herdrText;
	let refusals = 1;
	agent.io.herdrText = (args) => {
		const result = answer(args);
		if (refusals-- > 0) throw new Error("herdr pane report-agent failed (1)\nserver not running");
		return result;
	};

	agent.report({ state: "working", seq: 7 });
	t.mock.timers.tick(500);
	t.mock.timers.tick(500);
	agent.finish(0);
	await agent.exited;

	assert.deepEqual(agent.reports(), [
		["w1:host", "--source", "fleet:pi", "--agent", "pi", "--state", "working", "--seq", "7"],
		["w1:host", "--source", "fleet:pi", "--agent", "pi", "--state", "working", "--seq", "7"],
	]);
});
