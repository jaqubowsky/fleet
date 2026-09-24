import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Remote } from "./remote.ts";
import type { Binding } from "./runtime.ts";

const directory = () => join(mkdtempSync(join(tmpdir(), "pi-remote-")), "remote");
const assets = { session: {}, hub: {} };

async function free() {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	await new Promise<void>((resolve) => server.close(() => resolve()));
	return address.port;
}

function binding(name: string, idle = true, received: string[] = []): Binding {
	return {
		id: name,
		name,
		entries: [],
		idle: () => idle,
		header: () => ({ cwd: `/work/${name}`, model: "Opus 5" }),
		send: (text, mode) => {
			received.push(`${mode}:${text}`);
		},
		abort() {},
	};
}

async function running(t: TestContext, dir: string, port: number, session: Binding) {
	const remote = new Remote();
	t.after(() => remote.stop());
	remote.runtime.bind(Symbol(), session);
	await remote.start(dir, port, assets);
	return remote;
}

async function first(response: Response) {
	assert.equal(response.status, 200);
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	let pending = "";
	while (!pending.includes("\n\n")) {
		const chunk = await reader.read();
		assert.equal(chunk.done, false, "stream remains open");
		pending += decoder.decode(chunk.value, { stream: true });
	}
	await reader.cancel();
	const data = pending.split("\n").find((line) => line.startsWith("data: "))!;
	return JSON.parse(data.slice(6));
}

test("the hub lists every session with its name and status", async (t) => {
	const dir = directory();
	const port = await free();
	const writer = await running(t, dir, port, binding("writer"));
	const reviewer = await running(t, dir, port, binding("reviewer", false));
	const { origin, view } = writer.identity()!;

	const response = await fetch(`${origin}/sessions`, {
		headers: { Authorization: `Bearer ${view}` },
	});

	assert.equal(origin, `http://127.0.0.1:${port}`);
	assert.deepEqual(await response.json(), {
		sessions: [
			{
				id: reviewer.id,
				session: { id: "reviewer", name: "reviewer" },
				status: "running",
				header: { cwd: "/work/reviewer", model: "Opus 5", queued: false },
			},
			{
				id: writer.id,
				session: { id: "writer", name: "writer" },
				status: "idle",
				header: { cwd: "/work/writer", model: "Opus 5", queued: false },
			},
		],
	});
});

test("a session's page and API pass through the hub", { timeout: 10000 }, async (t) => {
	const dir = directory();
	const port = await free();
	const received: string[] = [];
	const writer = await running(t, dir, port, binding("writer", true, received));
	const { origin, token } = writer.identity()!;
	const headers = { Authorization: `Bearer ${token}` };
	const base = `${origin}/s/${writer.id}`;

	const redirect = await fetch(base, { redirect: "manual" });
	const snapshot = await (await fetch(`${base}/bootstrap`, { headers })).json();
	const frame = await first(await fetch(`${base}/events`, { headers }));
	const command = await fetch(`${base}/command`, {
		method: "POST",
		headers: { ...headers, "Content-Type": "application/json" },
		body: JSON.stringify({ generation: snapshot.generation, action: "prompt", text: "hello" }),
	});
	const ended = await fetch(`${origin}/s/0123456789abcdef/bootstrap`, { headers });

	assert.equal(redirect.status, 308);
	assert.equal(redirect.headers.get("location"), `/s/${writer.id}/`);
	assert.equal(snapshot.session.name, "writer");
	assert.equal(frame.session.name, "writer");
	assert.equal(command.status, 202);
	assert.deepEqual(received, ["prompt:hello"]);
	assert.equal(ended.status, 404);
	assert.deepEqual(await ended.json(), { error: "Session ended" });
});

test("the hub and every session refuse a caller without the link", async (t) => {
	const dir = directory();
	const port = await free();
	const writer = await running(t, dir, port, binding("writer"));
	const { origin } = writer.identity()!;
	const wrong = { Authorization: `Bearer ${"f".repeat(64)}` };

	const listed = await fetch(`${origin}/sessions`, { headers: wrong });
	const proxied = await fetch(`${origin}/s/${writer.id}/bootstrap`, { headers: wrong });

	assert.equal(listed.status, 401);
	assert.equal(proxied.status, 401);
});

test("a session whose process died leaves the list and the registry", async (t) => {
	const dir = directory();
	const port = await free();
	const writer = await running(t, dir, port, binding("writer"));
	const { origin, token } = writer.identity()!;
	const gone = join(dir, "sessions", "0123456789abcdef.json");
	mkdirSync(join(dir, "sessions"), { recursive: true });
	writeFileSync(gone, JSON.stringify({ port: 1, pid: spawnSync(process.execPath, ["-e", ""]).pid }));

	const response = await fetch(`${origin}/sessions`, {
		headers: { Authorization: `Bearer ${token}` },
	});

	const { sessions } = await response.json();
	assert.deepEqual(sessions.map((session: { id: string }) => session.id), [writer.id]);
	assert.equal(existsSync(gone), false);
});

test("when the hub quits, another session takes the port and phones find their session again", { timeout: 10000 }, async (t) => {
	const dir = directory();
	const port = await free();
	const hub = await running(t, dir, port, binding("hub"));
	const writer = await running(t, dir, port, binding("writer"));
	const { origin, token } = writer.identity()!;
	const reached = () =>
		fetch(`${origin}/s/${writer.id}/bootstrap`, { headers: { Authorization: `Bearer ${token}` } })
			.then((response) => response.status === 200, () => false);
	assert.equal(writer.identity()!.hub, false);

	await hub.stop();
	const deadline = Date.now() + 3000;
	while (!(await reached()) && Date.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 100));

	assert.equal(await reached(), true);
	assert.equal(writer.identity()!.hub, true);
});

test("the hub guards its pages like a session does", async (t) => {
	const dir = directory();
	const port = await free();
	const writer = await running(t, dir, port, binding("writer"));
	const { origin, token } = writer.identity()!;

	const page = await fetch(`${origin}/`);
	const foreign = await fetch(`${origin}/sessions`, {
		headers: { Authorization: `Bearer ${token}`, Origin: "https://attacker.invalid" },
	});

	assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/);
	assert.equal(foreign.status, 403);
});
