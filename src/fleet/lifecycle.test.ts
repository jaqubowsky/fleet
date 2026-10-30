import assert from "node:assert/strict";
import { test } from "node:test";
import { KINDS, SEATS } from "../harness.ts";
import { ls, peek, start, stop } from "./commands.ts";
import { fakeIo, liveTerminals } from "./fake-io.ts";
import type { Sandbox } from "./status.ts";

for (const kind of Object.values(KINDS)) {
	const sandbox: Sandbox = { name: `${kind.prefix}webapp-a`, kind, status: "running", workspaces: ["/w/webapp"] };
	const task = `/home/me/.fleet/tasks/webapp/${sandbox.name}`;
	const stopped = { ...sandbox, status: "stopped" };
	const fixture = {
		"herdr-app ls": { spaces: [{ id: "sp1", name: "WebApp", machine: null }, { id: "sp2", name: "webapp", machine: "vps" }] },
		"herdr-app do tab.new": { tab: "tb1", terminal: "t9" },
		"herdr-app do space.new": { space: "sp3", tab: "tb1", terminal: "t9" },
		"hc get t9": { state: "live", status: { state: "idle" } },
		"sbx exec": "-icanon -icrnl",
		[`list ${task}/logs/sessions`]: ["s1.jsonl"],
		[`list ${task}/logs/sessions/projects/-w-webapp`]: ["s1.jsonl"],
	};

	test(`${kind.name} stop closes the tab and keeps the session and dirty files`, () => {
		const io = fakeIo({ ...fixture, ...liveTerminals(sandbox.name) }, SEATS[kind.name]);
		io.files[`${task}/ticket.md`] = "# Restore projects\n";
		io.files[`${task}/logs/sessions/s1.jsonl`] = "saved conversation";

		stop(sandbox, io);

		assert.equal(io.files[`${task}/ticket.md`], "# Restore projects\n");
		assert.equal(io.files[`${task}/logs/sessions/s1.jsonl`], "saved conversation");
		assert.ok(io.calls.some((c) => c[0] === "append" && c[2].includes(` stop ${sandbox.name} `)));
		const steps = io.calls.filter((c) => c[0] === "sbx" || (c[0] === "hc" && c[1] === "kill")).map((c) => c.join(" "));
		assert.deepEqual(steps, [`sbx stop ${sandbox.name}`, "hc kill t2"]);
	});

	test(`${kind.name} a failed stop leaves the agent's tab open`, () => {
		const io = fakeIo({ ...fixture, ...liveTerminals(sandbox.name), "sbx stop": new Error("stop refused") });

		assert.throws(() => stop(sandbox, io), /stop refused/);

		assert.ok(!io.calls.some((c) => c[1] === "kill"));
		assert.equal(io.calls.filter((c) => c[0] === "append").length, 0);
	});

	test(`${kind.name} stopping a stopped container changes nothing`, () => {
		const io = fakeIo(fixture);

		assert.throws(() => stop(stopped, io), /already stopped/);

		assert.equal(io.calls.length, 0);
	});

	test(`${kind.name} start resumes the saved session in a new tab of the repository's space without a prompt`, async () => {
		const io = fakeIo(fixture, SEATS[kind.name]);

		await start(stopped, "/harness", io);

		const opened: string[] = io.calls.find((c) => c[0] === "herdr-app" && c[2] === "tab.new") ?? [];
		assert.equal(opened[opened.indexOf("--space") + 1], "sp1");
		assert.equal(opened[opened.indexOf("--name") + 1], sandbox.name);
		assert.deepEqual(JSON.parse(opened[opened.indexOf("--argv") + 1]), ["exec", "sbx", "run", "--name", sandbox.name, "--", ...kind.agentArgs, kind.resume]);
		assert.deepEqual(io.calls.find((c) => c[0] === "hc" && c[1] === "label"), ["hc", "label", "t9", "fleet=1", `fleet.sandbox=${sandbox.name}`, `fleet.task=${task}`]);
		assert.ok(io.calls.some((c) => c[0] === "append" && c[2].includes(` start ${sandbox.name} `)));
		assert.ok(!io.calls.some((c) => c[1] === "send"));
	});

	test(`${kind.name} start makes the repository's space when the window has none`, async () => {
		const io = fakeIo({ ...fixture, "herdr-app ls": { spaces: [] } }, SEATS[kind.name]);

		await start(stopped, "/harness", io);

		const made: string[] = io.calls.find((c) => c[0] === "herdr-app" && c[2] === "space.new") ?? [];
		assert.equal(made[made.indexOf("--name") + 1], "webapp");
		assert.equal(made[made.indexOf("--folder") + 1], "/w/webapp");
		assert.equal(made[made.indexOf("--tab") + 1], sandbox.name);
	});

	test(`${kind.name} start reopens a running container whose tab was closed`, async () => {
		const io = fakeIo(fixture, SEATS[kind.name]);

		await start(sandbox, "/harness", io);

		assert.ok(io.calls.some((c) => c[0] === "herdr-app" && c[2] === "tab.new"));
	});

	test(`${kind.name} start refuses a container that still has its tab`, async () => {
		const io = fakeIo({ ...fixture, ...liveTerminals(sandbox.name) }, SEATS[kind.name]);

		await assert.rejects(start(sandbox, "/harness", io), new RegExp(`${sandbox.name}: already runs in terminal t2`));

		assert.ok(!io.calls.some((c) => c[0] === "herdr-app"));
	});

	test(`${kind.name} start says so when the agent exits before it is ready`, async () => {
		const io = fakeIo({ ...fixture, "hc get t9": { state: "finished", status: null }, "hc read t9": "sandbox not found" }, SEATS[kind.name]);

		await assert.rejects(start(stopped, "/harness", io), /exited in terminal t9:\nsandbox not found/);
	});

	test(`${kind.name} start names a sandbox built from an older harness`, async () => {
		const io = fakeIo({ ...fixture, "git log -1 --format=%h": "f7e7f1a" }, SEATS[kind.name]);
		io.files[`${task}/logs/image-stamp`] = "31e3d51\n";

		await start(stopped, "/harness", io);

		assert.match(io.lines[0], new RegExp(`^${sandbox.name} was built from harness 31e3d51, and the harness is now f7e7f1a`));
	});

	test(`${kind.name} listing a stopped container does not probe the guest`, () => {
		const io = fakeIo({ ...fixture, "sbx ls --json": [{ ...stopped, agent: kind.name }] });

		const text = ls(io);

		assert.match(text, /stopped/);
		assert.equal(io.calls.filter((c) => c[0] === "sbx" && c[1] === "exec").length, 0);
	});

	test(`${kind.name} inspecting a stopped container leaves it asleep`, () => {
		const io = fakeIo({ ...fixture, "sbx ls --json": [{ ...stopped, agent: kind.name }] });

		const text = peek(sandbox.name, io);

		assert.match(text, /stopped; checkout not probed/);
		assert.equal(io.calls.filter((c) => c[0] === "sbx" && c[1] === "exec").length, 0);
	});
}
