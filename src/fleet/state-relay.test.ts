import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import stateRelay from "../../extensions/state-relay.ts";

const VARIABLES = ["HERDR_ENV", "HERDR_SOCKET_PATH", "FLEET_AGENT_STATE"] as const;

function container(t: TestContext) {
	const dir = mkdtempSync(join(tmpdir(), "state-relay-"));
	const saved = VARIABLES.map((name) => [name, process.env[name]] as const);
	t.after(() => {
		for (const [name, value] of saved) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		rmSync(dir, { recursive: true, force: true });
	});
	const socket = join(dir, "herdr.sock");
	const start = (file: string) => {
		process.env.HERDR_ENV = "1";
		process.env.HERDR_SOCKET_PATH = socket;
		process.env.FLEET_AGENT_STATE = join(dir, file);
		return stateRelay();
	};
	const ask = (request: unknown) =>
		new Promise<unknown>((resolve, reject) => {
			const client = net.createConnection(socket);
			client.on("error", reject);
			client.on("connect", () => client.write(`${JSON.stringify(request)}\n`));
			client.on("data", (chunk) => {
				client.destroy();
				resolve(JSON.parse(chunk.toString().split("\n")[0]));
			});
		});
	const state = (file: string) => {
		try {
			return JSON.parse(readFileSync(join(dir, file), "utf8"));
		} catch {
			return undefined;
		}
	};
	return { socket, start, ask, state };
}

const REPORT = {
	id: "herdr:omp:1",
	method: "pane.report_agent",
	params: { pane_id: "w1:p1", source: "herdr:omp", agent: "omp", state: "working", message: "Running tests", seq: 7, agent_session_path: "/home/agent/.omp/s.jsonl" },
};

test("herdr's integration gets an answer, and its state lands in the task directory", async (t: TestContext) => {
	const agent = container(t);
	await agent.start("agent-state.json");

	const session = await agent.ask({ id: "herdr:omp:session:1", method: "pane.report_agent_session", params: { pane_id: "w1:p1", seq: 6 } });
	const before = agent.state("agent-state.json");
	const answer = await agent.ask(REPORT);

	assert.deepEqual(session, { id: "herdr:omp:session:1", result: {} });
	assert.equal(before, undefined);
	assert.deepEqual(answer, { id: "herdr:omp:1", result: {} });
	assert.deepEqual(agent.state("agent-state.json"), { state: "working", message: "Running tests", seq: 7 });
});

test("a nested agent process in the container leaves the socket to the root one", async (t: TestContext) => {
	const agent = container(t);
	await agent.start("root.json");

	await agent.start("nested.json");
	await agent.ask(REPORT);

	assert.equal(agent.state("root.json").state, "working");
	assert.equal(agent.state("nested.json"), undefined);
});

test("a socket an earlier run left behind with nobody on it is taken over", async (t: TestContext) => {
	const agent = container(t);
	spawnSync(process.execPath, ["-e", `require("node:net").createServer().listen(${JSON.stringify(agent.socket)}, () => process.kill(process.pid, "SIGKILL"))`]);
	assert.ok(existsSync(agent.socket));

	await agent.start("agent-state.json");
	await agent.ask(REPORT);

	assert.equal(agent.state("agent-state.json").state, "working");
});

test("a client that hangs up before its answer leaves the relay answering", async (t: TestContext) => {
	const agent = container(t);
	await agent.start("agent-state.json");
	const hungUp = net.createConnection(agent.socket);
	await new Promise((resolve) => hungUp.on("connect", resolve));

	hungUp.end(`${JSON.stringify(REPORT)}\n`);
	hungUp.destroy();
	await new Promise((resolve) => setTimeout(resolve, 50));
	const answer = await agent.ask({ ...REPORT, id: "herdr:omp:2" });

	assert.deepEqual(answer, { id: "herdr:omp:2", result: {} });
});
