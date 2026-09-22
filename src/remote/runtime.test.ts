import assert from "node:assert/strict";
import test from "node:test";
import { RemoteRuntime, type Binding } from "./runtime.ts";

function binding(id: string, received: string[] = []): Binding {
	return {
		id,
		name: id,
		entries: [
			{
				type: "message",
				message: { role: "user", content: `hello ${id}`, secret: "private" },
			},
		],
		idle: () => true,
		send: (text, mode) => {
			received.push(`${mode}:${text}`);
		},
		abort: () => {
			received.push("abort");
		},
	};
}

async function connect(remote: RemoteRuntime) {
	const { origin, token } = remote.identity()!;
	const headers = { Authorization: `Bearer ${token}` };
	return {
		get: (path: string) => fetch(origin + path, { headers }),
		command: (body: unknown) =>
			fetch(origin + "/command", {
				method: "POST",
				headers: { ...headers, "Content-Type": "application/json" },
				body: JSON.stringify(body),
			}),
	};
}

async function stream(remote: RemoteRuntime) {
	const client = await connect(remote);
	const response = await client.get("/events");
	assert.equal(response.status, 200);
	const reader = response.body!.getReader();
	let pending = "";
	const decoder = new TextDecoder();
	return {
		close: () => reader.cancel(),
		next: async () => {
			for (;;) {
				const end = pending.indexOf("\n\n");
				if (end >= 0) {
					const frame = pending.slice(0, end);
					pending = pending.slice(end + 2);
					const data = frame
						.split("\n")
						.find((line) => line.startsWith("data: "));
					if (data) return JSON.parse(data.slice(6));
				} else {
					const chunk = await reader.read();
					assert.equal(chunk.done, false, "stream remains open");
					pending += decoder.decode(chunk.value, { stream: true });
				}
			}
		},
	};
}

test(
	"phone and stream survive every session replacement",
	{ timeout: 10000 },
	async (t) => {
		const remote = new RemoteRuntime();
		t.after(() => remote.stop());
		let owner = Symbol();
		remote.bind(owner, binding("initial"));
		await remote.start(0);
		const identity = remote.identity();
		const client = await connect(remote);
		const events = await stream(remote);
		t.after(() => events.close());
		let snapshot = await events.next();
		assert.equal(snapshot.session.id, "initial");

		for (const reason of ["new", "resume", "fork", "reload"]) {
			const old = owner;
			remote.detach(old);
			assert.equal(
				(
					await client.command({
						generation: snapshot.generation,
						action: "abort",
					})
				).status,
				503,
			);
			assert.equal((await events.next()).status, "reconnecting");
			owner = Symbol();
			const received: string[] = [];
			remote.bind(owner, binding(reason, received));
			remote.detach(old);
			remote.publish(old, {
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "stale" }],
				},
			});
			const next = await events.next();
			assert.equal(next.session.id, reason);
			assert.ok(
				remote.identity()?.token === identity?.token &&
					remote.identity()?.origin === identity?.origin,
				"identity survives replacement",
			);
			assert.equal(
				(
					await client.command({
						generation: snapshot.generation,
						action: "prompt",
						text: "old",
					})
				).status,
				409,
			);
			assert.equal(
				(
					await client.command({
						generation: next.generation,
						action: "prompt",
						text: "fresh",
					})
				).status,
				202,
			);
			assert.deepEqual(received, ["prompt:fresh"]);
			snapshot = next;
		}
		assert.equal(
			JSON.stringify(await (await client.get("/bootstrap")).json()).includes(
				"stale",
			),
			false,
		);
		const reconnected = await stream(remote);
		assert.equal((await reconnected.next()).session.id, "reload");
		await reconnected.close();
		await events.close();
		await remote.stop();
		assert.ok(remote.identity() === undefined, "stop revokes identity");
		await assert.rejects(() => client.get("/bootstrap"));
	},
);

test("protocol bounds input and projects only public text", async (t) => {
	const received: string[] = [];
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	const owner = Symbol();
	const generation = remote.bind(owner, binding("one", received));
	await remote.start(0);
	const client = await connect(remote);
	const snapshot = await (await client.get("/bootstrap")).json();
	assert.deepEqual(snapshot.transcript, [
		{ role: "user", blocks: [{ kind: "text", text: "hello one" }] },
	]);
	assert.equal(JSON.stringify(snapshot).includes("private"), false);
	for (const action of ["prompt", "steer", "followUp", "abort"]) {
		assert.equal(
			(
				await client.command({
					generation,
					action,
					...(action === "abort" ? {} : { text: "hello" }),
				})
			).status,
			202,
		);
	}
	assert.deepEqual(received, [
		"prompt:hello",
		"steer:hello",
		"followUp:hello",
		"abort",
	]);
	for (const body of [
		{ generation, action: "shell", text: "ls" },
		{ generation, action: "prompt", text: "" },
		{ generation, action: "prompt", text: "hi", extra: true },
		{ generation, action: ["prompt"], text: "bad type" },
		null,
	]) {
		assert.equal((await client.command(body)).status, 400);
	}
	assert.equal(
		(
			await client.command({
				generation,
				action: "prompt",
				text: "x".repeat(20000),
			})
		).status,
		413,
	);
	remote.publish(owner, {
		type: "message_update",
		message: {
			role: "assistant",
			content: [
				{ type: "text", text: "answer" },
				{ type: "thinking", thinking: "secret" },
			],
			usage: { secret: true },
		},
	});
	remote.publish(owner, {
		type: "tool_execution_update",
		toolName: "read",
		toolCallId: "t1",
		args: { path: "/tmp/notes.md", token: "ghp_abcdefghijklmnopqrst" },
		partialResult: {
			content: [{ type: "text", text: "result" }],
			details: { hidden: "secret" },
		},
	});
	const live = await (await client.get("/bootstrap")).json();
	assert.deepEqual(live.assistant, {
		role: "assistant",
		blocks: [{ kind: "text", text: "answer" }],
	});
	assert.deepEqual(live.tools, [
		{
			kind: "tool",
			id: "t1",
			name: "read",
			summary: "/tmp/notes.md",
			state: "running",
			result: "result",
		},
	]);
	assert.equal(
		JSON.stringify(live).includes("secret"),
		false,
		"thinking, usage and tool details stay out",
	);
	assert.equal(
		JSON.stringify(live).includes("ghp_"),
		false,
		"a secret in an argument is masked",
	);
});

test("only the bearer holder can read a session", async (t) => {
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	await remote.start(0);
	const { origin, token } = remote.identity()!;

	const denied = await fetch(`${origin}/bootstrap`);
	const allowed = await fetch(`${origin}/bootstrap`, {
		headers: { Authorization: `Bearer ${token}` },
	});

	assert.equal(denied.status, 401);
	assert.equal(allowed.status, 200);
	assert.ok(/^[a-f0-9]{64}$/.test(token), "token has 256 random bits");
	assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
	assert.equal(JSON.stringify(await allowed.json()).includes(token), false);
	for (const path of ["/bootstrap", "/events", "/command"]) {
		assert.equal(
			(
				await fetch(origin + path, {
					headers: { Authorization: "Bearer wrong" },
				})
			).status,
			401,
		);
		assert.equal((await fetch(`${origin}${path}?token=${token}`)).status, 401);
	}
	assert.equal(
		(
			await fetch(`${origin}/bootstrap`, {
				headers: {
					Authorization: `Bearer ${token}`,
					Origin: "https://attacker.invalid",
				},
			})
		).status,
		403,
	);
});

test("snapshots and connected phones have finite bounds", async (t) => {
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	const owner = Symbol();
	remote.bind(owner, {
		...binding("bounded"),
		entries: Array.from({ length: 1000 }, () => ({
			type: "message",
			message: { role: "user", content: "x".repeat(10000) },
		})),
	});
	await Promise.all([remote.start(0), remote.start(0)]);
	const client = await connect(remote);
	const before = remote.identity();
	await remote.start(9999);
	assert.ok(
		remote.identity()?.origin === before?.origin &&
			remote.identity()?.token === before?.token,
	);
	const snapshot = await (await client.get("/bootstrap")).json();
	assert.equal(snapshot.transcript.length, 64);
	assert.equal(snapshot.transcript[0].blocks[0].text.length, 4096);
	const phones: Awaited<ReturnType<typeof stream>>[] = [];
	for (let i = 0; i < 8; i++) phones.push(await stream(remote));
	t.after(() => Promise.all(phones.map((phone) => phone.close())));
	assert.equal((await client.get("/events")).status, 429);
	for (const phone of phones) await phone.close();
});

test("busy sessions reject prompts but accept steering and abort", async (t) => {
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	const sent: string[] = [];
	const generation = remote.bind(Symbol(), {
		...binding("busy", sent),
		idle: () => false,
	});
	await remote.start(0);
	const client = await connect(remote);
	assert.equal(
		(await client.command({ generation, action: "prompt", text: "wait" }))
			.status,
		409,
	);
	assert.equal(
		(await client.command({ generation, action: "steer", text: "redirect" }))
			.status,
		202,
	);
	assert.equal(
		(await client.command({ generation, action: "abort" })).status,
		202,
	);
	assert.deepEqual(sent, ["steer:redirect", "abort"]);
});

test(
	"phone sees live updates and resyncs after disconnect",
	{ timeout: 5000 },
	async (t) => {
		const remote = new RemoteRuntime();
		t.after(() => remote.stop());
		const owner = Symbol();
		remote.bind(owner, binding("live"));
		await remote.start(0);
		const phone = await stream(remote);
		await phone.next();
		remote.publish(owner, { type: "agent_start" });
		remote.publish(owner, {
			type: "message_update",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "draft" }],
			},
		});
		const live = await phone.next();
		assert.equal(live.status, "running");
		assert.equal(live.assistant.blocks[0].text, "draft");
		await phone.close();
		remote.publish(owner, {
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "finished" }],
			},
		});
		remote.publish(owner, { type: "agent_settled" });
		const reconnected = await stream(remote);
		const recovered = await reconnected.next();
		assert.equal(recovered.status, "idle");
		assert.equal(recovered.transcript.at(-1).blocks[0].text, "finished");
		assert.equal(recovered.assistant, undefined);
		await reconnected.close();
	},
);
