import assert from "node:assert/strict";
import test from "node:test";
import { RemoteRuntime, type Binding } from "./runtime.ts";

const keys = () => ({ control: "a".repeat(64), view: "b".repeat(64) });

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
		header: () => ({}),
		send: (text, mode) => {
			received.push(`${mode}:${text}`);
		},
		abort: () => {
			received.push("abort");
		},
		listening() {},
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
		await remote.start(0, {}, keys);
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

test("completed tool and output reach both the stream and a fresh snapshot", async (t) => {
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	const owner = Symbol();
	remote.bind(owner, binding("tools"));
	await remote.start(0, {}, keys);
	const events = await stream(remote);
	t.after(() => events.close());
	await events.next();
	remote.publish(owner, {
		type: "tool_execution_start",
		toolCallId: "c1",
		toolName: "bash",
		args: { command: "printf complete" },
	});
	remote.publish(owner, {
		type: "message_end",
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "printf complete" } }],
		},
	});
	remote.publish(owner, {
		type: "tool_execution_end",
		toolCallId: "c1",
		toolName: "bash",
		result: { content: [{ type: "text", text: "complete" }] },
		isError: false,
	});
	remote.publish(owner, {
		type: "message_end",
		message: {
			role: "toolResult",
			toolCallId: "c1",
			content: [{ type: "text", text: "complete" }],
			isError: false,
		},
	});
	const live = await events.next();
	const fresh = await (await (await connect(remote)).get("/bootstrap")).json();
	const expected = {
		kind: "tool",
		id: "c1",
		name: "bash",
		summary: "printf complete",
		state: "done",
		result: "complete",
	};
	for (const snapshot of [live, fresh]) {
		assert.deepEqual(snapshot.transcript.at(-1).blocks, [expected]);
		assert.deepEqual(snapshot.tools, [expected]);
	}
});

test("parallel completion preserves an evicted bash command", async (t) => {
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	const owner = Symbol();
	remote.bind(owner, binding("parallel"));
	await remote.start(0, {}, keys);
	const client = await connect(remote);
	const calls = Array.from({ length: 17 }, (_, index) => ({
		type: "toolCall", id: `bash-${index}`, name: "bash",
		arguments: { command: `printf ${index}` },
	}));

	remote.publish(owner, {
		type: "message_end", message: { role: "assistant", content: calls },
	});
	for (const call of calls)
		remote.publish(owner, {
			type: "tool_execution_start", toolCallId: call.id,
			toolName: call.name, args: call.arguments,
		});
	remote.publish(owner, {
		type: "tool_execution_end", toolCallId: "bash-0", toolName: "bash",
		isError: false, result: { content: [{ type: "text", text: "0" }] },
	});
	const snapshot = await (await client.get("/bootstrap")).json();

	assert.deepEqual(snapshot.transcript.at(-1).blocks[0], {
		kind: "tool", id: "bash-0", name: "bash", summary: "printf 0",
		state: "done", result: "0",
	});
	remote.publish(owner, {
		type: "message_end", message: {
			role: "toolResult", toolCallId: "bash-0", isError: false,
			content: [{ type: "text", text: "confirmed 0" }],
		},
	});
	const final = await (await client.get("/bootstrap")).json();
	assert.equal(final.transcript.at(-1).blocks[0].summary, "printf 0");
	assert.equal(final.transcript.at(-1).blocks[0].result, "confirmed 0");
});

test("submitted text matches bounded user messages after history moves", async (t) => {
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	const owner = Symbol();
	const generation = remote.bind(owner, binding("queue"));
	await remote.start(0, {}, keys);
	const client = await connect(remote);
	const first = await (await client.get("/bootstrap")).json();
	assert.equal(first.transcript[0].seq, 1);
	assert.equal(first.userSequence, 1);

	const long = "x".repeat(5000);
	const accepted = await (await client.command({ generation, action: "followUp", text: long })).json();
	assert.ok(accepted.display.length <= 4096);
	assert.match(accepted.display, /characters omitted/);
	assert.ok(accepted.display.startsWith("xxx") && accepted.display.endsWith("xxx"));
	const masked = await (await client.command({
		generation, action: "followUp", text: "token sk-ant-abcdefgh12345678 end",
	})).json();
	assert.equal(masked.display, "token [redacted] end");

	for (let index = 0; index < 64; index++)
		remote.publish(owner, {
			type: "message_end",
			message: { role: "assistant", content: `filler ${index}` },
		});
	remote.publish(owner, {
		type: "message_end",
		message: { role: "user", content: "hello queue" },
	});
	const next = await (await client.get("/bootstrap")).json();
	assert.equal(next.transcript.at(-1).seq, 2);
	assert.equal(next.userSequence, 2);
	assert.equal(next.transcript.some((item: { seq?: number }) => item.seq === 1), false);
});

test("snapshot keeps its user watermark when live tools hide history", async (t) => {
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	const owner = Symbol();
	const session = binding("history");
	session.entries.push(...Array.from({ length: 3 }, (_, index) => ({
		type: "message",
		message: {
			role: "assistant",
			content: Array.from({ length: 32 }, (_, slot) => ({
				type: "text", text: `${index}-${slot}:` + "x".repeat(4089),
			})),
		},
	})));
	remote.bind(owner, session);
	await remote.start(0, {}, keys);
	const client = await connect(remote);
	const snapshot = () => client.get("/bootstrap").then((response) => response.json());
	assert.equal((await snapshot()).transcript[0].seq, 1);

	for (let index = 0; index < 16; index++) {
		const toolCallId = `large-${index}`;
		remote.publish(owner, {
			type: "tool_execution_start", toolCallId, toolName: "edit",
			args: { path: "file", edits: [{ oldText: "x".repeat(3000), newText: "y".repeat(3000) }] },
		});
		remote.publish(owner, {
			type: "tool_execution_end", toolCallId, toolName: "edit", isError: false,
			result: { content: [{ type: "text", text: "z".repeat(4096) }] },
		});
	}
	const hidden = await snapshot();
	assert.equal(hidden.userSequence, 1);
	assert.equal(hidden.transcript.some((item: { seq?: number }) => item.seq === 1), false);

	for (let index = 0; index < 16; index++)
		remote.publish(owner, {
			type: "tool_execution_start", toolCallId: `small-${index}`,
			toolName: "bash", args: { command: "true" },
		});
	const restored = await snapshot();
	assert.equal(restored.userSequence, 1);
	assert.equal(restored.transcript[0].seq, 1);
});

test("protocol bounds input and projects only public text", async (t) => {
	const received: string[] = [];
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	const owner = Symbol();
	const generation = remote.bind(owner, binding("one", received));
	await remote.start(0, {}, keys);
	const client = await connect(remote);
	const snapshot = await (await client.get("/bootstrap")).json();
	assert.deepEqual(snapshot.transcript, [
		{ role: "user", blocks: [{ kind: "text", text: "hello one" }], seq: 1 },
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
	await remote.start(0, {}, keys);
	const { origin, token } = remote.identity()!;

	const denied = await fetch(`${origin}/bootstrap`);
	const allowed = await fetch(`${origin}/bootstrap`, {
		headers: { Authorization: `Bearer ${token}` },
	});

	assert.equal(denied.status, 401);
	assert.equal(allowed.status, 200);
	assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
	assert.equal(JSON.stringify(await allowed.json()).includes(token), false);
	for (const path of ["/bootstrap", "/summary", "/events", "/command"]) {
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
	await Promise.all([remote.start(0, {}, keys), remote.start(0, {}, keys)]);
	const client = await connect(remote);
	const before = remote.identity();
	await remote.start(9999, {}, keys);
	assert.ok(
		remote.identity()?.origin === before?.origin &&
			remote.identity()?.token === before?.token,
	);
	const snapshot = await (await client.get("/bootstrap")).json();
	assert.equal(snapshot.transcript.length, 64);
	const oldest = snapshot.transcript[0].blocks[0].text;
	assert.ok(oldest.length <= 4096, `text stays inside 4096, got ${oldest.length}`);
	assert.match(oldest, /\n… \d+ characters omitted …\n/);
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
	await remote.start(0, {}, keys);
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
		await remote.start(0, {}, keys);
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

test("the phone header says where the session stands", async (t) => {
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	const owner = Symbol();
	remote.bind(owner, {
		...binding("headed"),
		header: () => ({
			cwd: "/Users/someone/work",
			model: "claude-opus-5",
			percent: 42.7,
			cost: 1.2345,
			queued: true,
		}),
	});
	await remote.start(0, {}, keys);
	const client = await connect(remote);

	const snapshot = await (await client.get("/bootstrap")).json();

	assert.deepEqual(snapshot.header, {
		cwd: "/Users/someone/work",
		model: "claude-opus-5",
		percent: 43,
		cost: 1.23,
		queued: true,
	});
});

test("a host that exposes nothing gets an empty header", async (t) => {
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	remote.bind(Symbol(), { ...binding("bare"), header: () => ({}) });
	await remote.start(0, {}, keys);
	const client = await connect(remote);

	const snapshot = await (await client.get("/bootstrap")).json();

	assert.deepEqual(snapshot.header, { queued: false });
});

test("the view link shows everything and controls nothing", async (t) => {
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	remote.bind(Symbol(), binding("shared"));
	await remote.start(0, {}, keys);
	const { origin, token, view } = remote.identity()!;
	const as = (credential: string) => ({
		Authorization: `Bearer ${credential}`,
	});
	const command = (credential: string) =>
		fetch(`${origin}/command`, {
			method: "POST",
			headers: { ...as(credential), "Content-Type": "application/json" },
			body: JSON.stringify({ generation: 1, action: "abort" }),
		});

	const seen: Response = await fetch(`${origin}/bootstrap`, {
		headers: as(view),
	});
	const held: Response = await fetch(`${origin}/bootstrap`, {
		headers: as(token),
	});

	assert.notEqual(view, token);
	assert.equal(seen.status, 200);
	assert.equal((await seen.json()).control, false);
	assert.equal((await held.json()).control, true);
	assert.equal((await command(view)).status, 403);
	assert.equal((await command(token)).status, 202);
	const watching = await fetch(`${origin}/events`, { headers: as(view) });
	assert.equal(watching.status, 200);
	await watching.body!.cancel();
	await remote.stop();
	await assert.rejects(fetch(`${origin}/bootstrap`, { headers: as(view) }));
});

test("a long-running session keeps its snapshot inside the budget", async (t) => {
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	const owner = Symbol();
	remote.bind(owner, binding("growing"));
	await remote.start(0, {}, keys);
	const client = await connect(remote);
	const filler = "y".repeat(200_000);

	for (let turn = 0; turn < 64; turn++)
		remote.publish(owner, {
			type: "message_end",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: filler },
					...Array.from({ length: 40 }, (_, slot) => ({
						type: "toolCall",
						id: `t${turn}-${slot}`,
						name: "edit",
						arguments: {
							path: filler,
							edits: [{ oldText: filler, newText: filler }],
						},
					})),
				],
			},
		});

	const snapshot = await (await client.get("/bootstrap")).json();
	const size = JSON.stringify(snapshot.transcript).length;

	assert.ok(snapshot.transcript.length > 0, "the newest turn survives");
	assert.ok(size <= 524_288, `live transcript stays inside 512 KiB, got ${size}`);
});

test("a finished tool reports how it ended", async (t) => {
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	const owner = Symbol();
	remote.bind(owner, binding("settling"));
	await remote.start(0, {}, keys);
	const client = await connect(remote);

	remote.publish(owner, {
		type: "tool_execution_end",
		toolCallId: "e1",
		toolName: "bash",
		args: { command: "false" },
		isError: true,
		result: {
			content: [{ type: "text", text: "exit 1" }],
			details: { hidden: "secret" },
		},
	});

	const snapshot = await (await client.get("/bootstrap")).json();

	assert.deepEqual(snapshot.tools, [
		{
			kind: "tool",
			id: "e1",
			name: "bash",
			summary: "false",
			state: "error",
			result: "exit 1",
		},
	]);
});

test("view-only phones never take the last stream from the control link", async (t) => {
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	remote.bind(Symbol(), binding("shared"));
	await remote.start(0, {}, keys);
	const { origin, token, view } = remote.identity()!;
	const open = async (credential: string) => {
		const response: Response = await fetch(`${origin}/events`, {
			headers: { Authorization: `Bearer ${credential}` },
		});
		if (response.body) t.after(() => response.body!.cancel().catch(() => {}));
		return response.status;
	};

	const watching = [];
	for (let seat = 0; seat < 4; seat++) watching.push(await open(view));

	assert.deepEqual(watching, [200, 200, 200, 200], "four viewers are welcome");
	assert.equal(await open(view), 429, "the fifth viewer is turned away");
	assert.equal(await open(token), 200, "the control link still gets a stream");
});

test("the whole frame stays inside the documented budget", async (t) => {
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	const owner = Symbol();
	remote.bind(owner, binding("loaded"));
	await remote.start(0, {}, keys);
	const client = await connect(remote);
	const filler = "z".repeat(200_000);
	const blocks = (turn: number) => [
		{ type: "text", text: filler },
		...Array.from({ length: 40 }, (_, slot) => ({
			type: "toolCall",
			id: `f${turn}-${slot}`,
			name: "edit",
			arguments: {
				path: filler,
				edits: [{ oldText: filler, newText: filler }],
			},
		})),
	];

	for (let turn = 0; turn < 64; turn++)
		remote.publish(owner, {
			type: "message_end",
			message: { role: "assistant", content: blocks(turn) },
		});
	remote.publish(owner, {
		type: "message_update",
		message: { role: "assistant", content: blocks(99) },
	});
	for (let slot = 0; slot < 16; slot++)
		remote.publish(owner, {
			type: "tool_execution_end",
			toolCallId: `live-${slot}`,
			toolName: "edit",
			args: { path: filler, edits: [{ oldText: filler, newText: filler }] },
			isError: false,
			result: {
				content: [{ type: "text", text: filler }],
				details: { patch: filler },
			},
		});

	const frame = await (await client.get("/bootstrap")).text();

	assert.ok(
		JSON.parse(frame).transcript.length > 0,
		"the newest turn survives the squeeze",
	);
	assert.ok(
		frame.length <= 524_288,
		`the whole frame stays inside 512 KiB, got ${frame.length}`,
	);
});

test("a frame of many small turns is bounded by its transcript", async (t) => {
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	const owner = Symbol();
	remote.bind(owner, binding("chatty"));
	await remote.start(0, {}, keys);
	const client = await connect(remote);

	for (let turn = 0; turn < 64; turn++)
		remote.publish(owner, {
			type: "message_end",
			message: {
				role: "assistant",
				content: Array.from({ length: 8 }, () => ({
					type: "text",
					text: `"\t${"q".repeat(4000)}"`,
				})),
			},
		});

	const frame = await (await client.get("/bootstrap")).text();

	assert.ok(
		JSON.parse(frame).transcript.length > 1,
		"many small turns are kept, not squeezed to one",
	);
	assert.ok(
		frame.length <= 524_288,
		`the whole frame stays inside 512 KiB, got ${frame.length}`,
	);
});

test("the session hears how many phones watch it while it listens", { timeout: 10000 }, async (t) => {
	const remote = new RemoteRuntime();
	t.after(() => remote.stop());
	const counts: (number | undefined)[] = [];
	remote.bind(Symbol(), { ...binding("counted"), listening: (phones) => counts.push(phones) });
	await remote.start(0, {}, keys);

	const phone = await stream(remote);
	await phone.next();
	await phone.close();
	const deadline = Date.now() + 3000;
	while (counts.at(-1) !== 0 && Date.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 20));
	await remote.stop();

	assert.deepEqual(counts, [0, 1, 0, undefined]);
});
