import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Remote } from "./remote.ts";

const directory = () => join(mkdtempSync(join(tmpdir(), "pi-remote-")), "remote");

const bootstrap = (origin: string, token: string) =>
	fetch(`${origin}/bootstrap`, { headers: { Authorization: `Bearer ${token}` } });

test("a link outlives the process that issued it", async (t) => {
	const dir = directory();
	const first = new Remote();
	await first.start(dir, 0, {});
	const { token, view } = first.identity()!;
	await first.stop();

	const second = new Remote();
	t.after(() => second.stop());
	await second.start(dir, 0, {});

	assert.equal((await bootstrap(second.identity()!.origin, token)).status, 200);
	assert.equal(second.identity()!.view, view);
});

test("the stored link is readable by its owner alone", async (t) => {
	const dir = directory();
	const remote = new Remote();
	t.after(() => remote.stop());

	await remote.start(dir, 0, {});

	assert.equal(statSync(dir).mode & 0o777, 0o700);
	assert.equal(statSync(join(dir, "credentials.json")).mode & 0o777, 0o600);
});

test("the two links are distinct 256-bit secrets", async (t) => {
	const remote = new Remote();
	t.after(() => remote.stop());

	await remote.start(directory(), 0, {});

	const { token, view } = remote.identity()!;
	assert.match(token, /^[a-f0-9]{64}$/);
	assert.match(view, /^[a-f0-9]{64}$/);
	assert.notEqual(token, view);
});

async function ended(origin: string, token: string) {
	const response = await fetch(`${origin}/events`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	const reader = response.body!.getReader();
	await reader.read();
	return {
		closed: (async () => {
			try {
				while (!(await reader.read()).done);
			} catch {}
		})(),
	};
}

test("revoking ends every phone's stream and refuses the old link", { timeout: 10000 }, async (t) => {
	const dir = directory();
	const here = new Remote();
	const there = new Remote();
	t.after(() => Promise.all([here.stop(), there.stop()]));
	await here.start(dir, 0, {});
	await there.start(dir, 0, {});
	const { token } = here.identity()!;
	const streams = [
		await ended(here.identity()!.origin, token),
		await ended(there.identity()!.origin, token),
	];

	here.revoke(dir);
	await Promise.all(streams.map((stream) => stream.closed));

	assert.equal((await bootstrap(there.identity()!.origin, token)).status, 401);
	assert.notEqual(there.identity()!.token, token);
	assert.equal((await bootstrap(there.identity()!.origin, there.identity()!.token)).status, 200);
});

test("reading the stored link never ends a phone's stream", { timeout: 10000 }, async (t) => {
	const remote = new Remote();
	t.after(() => remote.stop());
	await remote.start(directory(), 0, {});
	const { origin, token } = remote.identity()!;
	let closed = false;
	void (await ended(origin, token)).closed.then(() => {
		closed = true;
	});

	for (let request = 0; request < 5; request++) {
		assert.equal((await bootstrap(origin, token)).status, 200);
		await new Promise((resolve) => setTimeout(resolve, 300));
	}

	assert.equal(closed, false);
});
