import assert from "node:assert/strict";
import { test } from "node:test";
import { KINDS, SEATS } from "../harness.ts";
import { handoff, ls, peek, start, stop, stopFile, stoppedPane, steer } from "./commands.ts";
import { fakeIo } from "./fake-io.ts";
import type { Sandbox } from "./status.ts";

for (const kind of Object.values(KINDS)) {
	const sandbox: Sandbox = { name: `${kind.prefix}webapp-a`, kind, status: "running", workspaces: ["/w/webapp"] };
	const task = `/home/me/.fleet/tasks/webapp/${sandbox.name}`;
	const stopped = { ...sandbox, status: "stopped" };
	const fixture = {
		"herdr agent list": { result: { agents: [{ name: sandbox.name, pane_id: "w1:p7", agent: kind.name }] } },
		"herdr agent get w1:p7": { result: { agent: { agent_status: "idle" } } },
		"sbx exec": "-icanon -icrnl",
		[`list ${task}/logs/sessions`]: ["s1.jsonl"],
		[`list ${task}/logs/sessions/projects/-w-webapp`]: ["s1.jsonl"],
	};

	test(`${kind.name} stop keeps the tab, session and dirty files`, async () => {
		const io = fakeIo(fixture, SEATS[kind.name]);
		io.files[`${task}/status.md`] = "status: implementing\nattention: none\n";
		io.files[`${task}/logs/sessions/s1.jsonl`] = "saved conversation";

		await stop(sandbox, io);

		assert.equal(stoppedPane(sandbox, io), "w1:p7");
		assert.equal(io.files[`${task}/status.md`], "status: implementing\nattention: none\n");
		assert.equal(io.files[`${task}/logs/sessions/s1.jsonl`], "saved conversation");
		assert.deepEqual(io.calls.filter((c) => c[0] === "sbx"), [["sbx", "stop", sandbox.name]]);
		assert.equal(io.calls.filter((c) => c.includes("close") || c.includes("rm")).length, 0);
	});

	test(`${kind.name} a stopped tab is reported under fleet's own label once herdr has let the exited agent go`, async () => {
		const io = fakeIo(fixture, SEATS[kind.name]);
		const herdr = io.herdr;
		let reads = 0;
		io.herdr = <T>(args: string[]) => {
			if (args[0] !== "pane" || args[1] !== "get") return herdr<T>(args);
			io.calls.push(["herdr", ...args]);
			reads += 1;
			return { result: { pane: reads < 3 ? { pane_id: "w1:p7", agent: kind.name } : { pane_id: "w1:p7" } } } as T;
		};

		await stop(sandbox, io);

		const herdrCalls = io.calls.filter((c) => c[0] === "herdr").map((c) => c.slice(1));
		const steps = herdrCalls.map((c) => c.slice(0, 2).join(" "));
		assert.deepEqual(steps.slice(steps.indexOf("pane send-keys")), ["pane send-keys", "pane get", "pane get", "pane get", "pane run", "pane report-agent", "pane report-metadata"]);
		assert.deepEqual(herdrCalls.find((c) => c[1] === "run"), ["pane", "run", "w1:p7", `HERDR_AGENT=${kind.name} fleet stopped ${sandbox.name}`]);
		const report: string[] = herdrCalls.find((c) => c[1] === "report-agent") ?? [];
		assert.equal(report[report.indexOf("--agent") + 1], "fleet");
		assert.ok(herdrCalls.some((c) => c[1] === "report-metadata" && c.includes("unknown=stopped")));
	});

	test(`${kind.name} start resumes the saved session in the same pane without a prompt`, async () => {
		const io = fakeIo(fixture, SEATS[kind.name]);
		io.files[stopFile(sandbox, io)] = JSON.stringify({ pane: "w1:p7" });

		await start(stopped, "/harness", io);

		const launched = io.calls.find((c) => c[2] === "run");
		const released: string[] = io.calls.find((c) => c[2] === "release-agent") ?? [];
		assert.equal(released[released.indexOf("--agent") + 1], "fleet");
		const closed = io.calls.findIndex((c) => c[2] === "send-keys" && c[3] === "w1:p7" && c[4] === "ctrl+c");
		assert.ok(closed >= 0 && closed < io.calls.indexOf(launched!), "the stopped view closes before the agent starts");
		assert.equal(launched?.[3], "w1:p7");
		assert.match(launched?.[4] ?? "", new RegExp(kind.resume));
		assert.ok(launched?.[4].includes(kind.herdrIntegration ? `/harness/bin/fleet relay ${sandbox.name} ${task}` : `sbx run --name ${sandbox.name}`));
		assert.equal(stoppedPane(sandbox, io), undefined);
		assert.equal(io.calls.filter((c) => c.includes("prompt") || c.includes("create")).length, 0);
	});

	test(`${kind.name} listing a pending stop does not probe the guest`, () => {
		const io = fakeIo({ ...fixture, "sbx ls --json": { sandboxes: [{ ...sandbox, agent: kind.name }] } });
		io.files[stopFile(sandbox, io)] = JSON.stringify({ pane: "w1:p7" });

		const text = ls(io);

		assert.match(text, /stopped/);
		assert.equal(io.calls.filter((c) => c[0] === "sbx" && c[1] === "exec").length, 0);
	});

	test(`${kind.name} inspecting a stopped pane leaves the container asleep`, () => {
		const io = fakeIo({ ...fixture, "sbx ls --json": { sandboxes: [{ ...stopped, agent: kind.name }] } });
		io.files[stopFile(sandbox, io)] = JSON.stringify({ pane: "w1:p7" });

		const text = peek(sandbox.name, io);

		assert.match(text, /stopped; checkout not probed/);
		assert.equal(io.calls.filter((c) => c[0] === "sbx" && c[1] === "exec").length, 0);
	});

	test(`${kind.name} a stopped container rejects a handoff`, async () => {
		const io = fakeIo(fixture);

		await assert.rejects(handoff(stopped, io), /fleet start/);

		assert.deepEqual(io.calls, []);
	});

	test(`${kind.name} a failed stop leaves the running agent available`, async () => {
		const io = fakeIo({ ...fixture, "sbx stop": new Error("stop refused") });

		await assert.rejects(stop(sandbox, io), /stop refused/);

		assert.equal(stoppedPane(sandbox, io), undefined);
		assert.equal(io.calls.filter((c) => c[2] === "report-agent").length, 0);
	});

	test(`${kind.name} stopping twice keeps the saved pane`, async () => {
		const io = fakeIo(fixture);
		io.files[stopFile(sandbox, io)] = JSON.stringify({ pane: "w1:p7" });

		await stop(stopped, io);

		assert.equal(stoppedPane(sandbox, io), "w1:p7");
		assert.equal(io.calls.filter((c) => c[0] === "sbx").length, 0);
	});

	test(`${kind.name} a pending stop rejects a steer even before sandboxd updates its status`, () => {
		const io = fakeIo(fixture);
		io.files[stopFile(sandbox, io)] = JSON.stringify({ pane: "w1:p7" });

		assert.throws(() => steer(sandbox, "go", io), /stopped; run fleet start/);

		assert.deepEqual(io.calls, []);
	});
}
