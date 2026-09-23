import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import remoteExtension, {
	type Context,
	type RemoteAPI,
	type Widget,
} from "../../extensions/pi-remote/index.ts";
import { processRuntime } from "./runtime.ts";

async function port() {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	await new Promise<void>((resolve) => server.close(() => resolve()));
	return address.port;
}

function session(id: string) {
	const handlers = new Map<string, Parameters<RemoteAPI["on"]>[1]>();
	let command: Parameters<RemoteAPI["registerCommand"]>[1];
	const sent: string[] = [];
	const notices: string[] = [];
	let widget: Widget | undefined;
	let stale = false;
	let name = id;
	const active = () => {
		assert.equal(stale, false, "old session is never accessed");
	};
	const context: Context = {
		mode: "tui",
		cwd: "/Users/someone/work",
		model: { id: "claude-opus-5", name: "Opus 5" },
		getContextUsage: () => ({ tokens: 4270, contextWindow: 10000, percent: 42.7 }),
		hasPendingMessages: () => true,
		sessionManager: {
			getSessionId: () => {
				active();
				return id;
			},
			getSessionName: () => name,
			getBranch: () => [
				{
					type: "message",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "hi" }],
						usage: { cost: { total: 0.5 } },
					},
				},
				{
					type: "message",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "again" }],
						usage: { cost: { total: 0.25 } },
					},
				},
			],
		},
		isIdle: () => {
			active();
			return true;
		},
		abort: () => {
			active();
			sent.push("abort");
		},
		ui: {
			notify: (text) => {
				notices.push(text);
			},
			setWidget: (_key, lines) => {
				widget = lines;
			},
		},
	};
	remoteExtension({
		on: (name, handler) => {
			handlers.set(name, handler);
		},
		registerCommand: (_name, value) => {
			command = value;
		},
		sendUserMessage: (text, options) => {
			active();
			sent.push(`${options?.deliverAs ?? "prompt"}:${text}`);
		},
	});
	return {
		sent,
		notices,
		widget: () => widget,
		widgetLines: (width = 80) =>
			typeof widget === "function"
				? widget(undefined, undefined).render(width)
				: widget,
		setName: (value: string) => {
			name = value;
		},
		command: (args: string) => command.handler(args, context),
		emit: (type: string, fields = {}) =>
			handlers.get(type)?.({ type, ...fields }, context),
		retire: () => {
			stale = true;
		},
	};
}

test("renaming preserves live activity and pending phone commands", async (t) => {
	const runtime = processRuntime();
	const current = session("running");
	t.after(() => current.emit("session_shutdown", { reason: "quit" }));
	await current.emit("session_start");
	await runtime.start(0);
	const identity = runtime.identity()!;
	const headers = { Authorization: `Bearer ${identity.token}` };
	const snapshot = () =>
		fetch(`${identity.origin}/bootstrap`, { headers }).then((response) =>
			response.json(),
		);
	await current.emit("message_update", {
		message: { role: "assistant", content: [{ type: "text", text: "draft" }] },
	});
	await current.emit("tool_execution_start", {
		toolCallId: "tool-1",
		toolName: "read",
		args: { path: "src/a.ts" },
	});
	await current.emit("ui_prompt_start");
	const before = await snapshot();

	current.setName("Renamed");
	await current.emit("session_info_changed", { name: "Renamed" });
	const after = await snapshot();

	assert.equal(after.session.name, "Renamed");
	assert.equal(after.status, "waiting for terminal");
	assert.deepEqual(after.assistant, {
		role: "assistant",
		blocks: [{ kind: "text", text: "draft" }],
	});
	assert.deepEqual(after.tools, [
		{
			kind: "tool",
			id: "tool-1",
			name: "read",
			summary: "src/a.ts",
			state: "running",
			result: "",
		},
	]);
	assert.equal(after.generation, before.generation);
	assert.deepEqual(after.header, {
		cwd: "/Users/someone/work",
		model: "Opus 5",
		percent: 43,
		cost: 0.75,
		queued: true,
	});
});

test("completed bash stays settled when the result message is delayed", async (t) => {
	const runtime = processRuntime();
	const current = session("bash-result");
	t.after(async () => {
		await current.emit("session_shutdown", { reason: "quit" });
		await runtime.stop();
	});
	await current.emit("session_start");
	await runtime.start(0);
	const { origin, token } = runtime.identity()!;
	const snapshot = () => fetch(`${origin}/bootstrap`, {
		headers: { Authorization: `Bearer ${token}` },
	}).then((response) => response.json());

	await current.emit("agent_start");
	await current.emit("message_end", {
		message: { role: "assistant", content: [
			{ type: "toolCall", id: "bash-1", name: "bash", arguments: { command: "printf done" } },
		] },
	});
	await current.emit("tool_execution_start", {
		toolCallId: "bash-1", toolName: "bash", args: { command: "printf done" },
	});
	await current.emit("tool_execution_end", {
		toolCallId: "bash-1", toolName: "bash", isError: false,
		result: { content: [{ type: "text", text: "done from Pi tool" }], details: {} },
	});
	const completed = await snapshot();

	await current.emit("message_end", {
		message: { role: "assistant", content: [{ type: "text", text: "Final answer" }] },
	});
	await current.emit("agent_settled");
	const idle = await snapshot();
	assert.equal(idle.status, "idle");
	assert.equal(idle.transcript.at(-1).blocks[0].text, "Final answer");
	const expected = {
		kind: "tool", id: "bash-1", name: "bash", summary: "printf done",
		state: "done", result: "done from Pi tool",
	};
	assert.deepEqual(idle.transcript.at(-2).blocks, [expected]);
	assert.deepEqual(completed.transcript.at(-1).blocks, [expected]);
});

test("extension controls a process runtime across fresh factories", {
	timeout: 15000,
}, async (t) => {
	const runtime = processRuntime();
	t.after(() => runtime.stop());
	let current = session("original");
	await current.emit("session_start", { reason: "startup" });
	await current.command(`start ${await port()}`);
	const identity = runtime.identity();
	assert.ok(identity);
	const headers = { Authorization: `Bearer ${identity.token}` };
	const initial = await fetch(`${identity.origin}/bootstrap`, { headers });
	assert.equal(initial.status, 200);
	assert.equal((await initial.json()).session.id, "original");
	const page = await fetch(`${identity.origin}/`);
	assert.equal(page.status, 200);
	assert.match(
		page.headers.get("content-security-policy")!,
		/default-src 'none'/,
	);
	assert.match(
		page.headers.get("content-security-policy")!,
		/manifest-src 'self'/,
	);
	assert.match(await page.text(), /Pi remote/);
	for (const path of [
		"/markdown.js",
		"/connection.js",
		"/vendor/marked.js",
		"/vendor/highlight.js",
		"/vendor/highlight-dark.css",
		"/vendor/highlight-light.css",
		"/manifest.webmanifest",
		"/icon.svg",
	]) {
		const library: Response = await fetch(identity.origin + path);
		assert.equal(library.status, 200, `${path} is public`);
		assert.ok((await library.text()).length > 0, `${path} has a body`);
	}
	assert.equal(
		(await fetch(`${identity.origin}/vendor/anything-else.js`)).status,
		401,
		"only the listed assets are public",
	);
	const stream = await fetch(`${identity.origin}/events`, { headers });
	const reader = stream.body!.getReader();
	t.after(() => reader.cancel());
	assert.match(
		new TextDecoder().decode((await reader.read()).value),
		/original/,
	);
	await current.command("link");
	const widgetLines = current.widgetLines();
	assert.equal(typeof current.widget(), "function");
	assert.ok(widgetLines && widgetLines.length > 10);
	assert.ok(widgetLines.join("").includes(`#${identity.token}`));
	assert.ok(widgetLines.every((line) => !line.includes("widget truncated")));
	await current.command("link --view");
	const viewLines = current.widgetLines();
	assert.ok(viewLines && viewLines.join("").includes(`#${identity.view}`));
	assert.ok(
		viewLines && !viewLines.join("").includes(identity.token),
		"the view link never carries the control credential",
	);
	assert.equal(current.notices.join("\n").includes(identity.token), false);
	await current.command("status");
	assert.ok(
		current.widget() === undefined,
		"status hides the credential widget",
	);

	for (const reason of ["new", "resume", "fork", "reload"]) {
		const old = current;
		await old.emit("session_shutdown", { reason });
		old.retire();
		current = session(reason);
		await current.emit("session_start", { reason });
		const reimported = await import(`./runtime.ts?${reason}`);
		assert.equal(reimported.processRuntime(), runtime);
		assert.ok(
			runtime.identity()?.token === identity.token &&
				runtime.identity()?.origin === identity.origin,
			"factory replacement preserves identity",
		);
		await old.emit("session_shutdown", { reason: "quit" });
		assert.ok(
			runtime.identity()?.token === identity.token &&
				runtime.identity()?.origin === identity.origin,
			"stale quit preserves identity",
		);
		const bootstrap = await (
			await fetch(`${identity.origin}/bootstrap`, { headers })
		).json();
		assert.equal(bootstrap.session.id, reason);
		const result: Response = await fetch(`${identity.origin}/command`, {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({
				generation: bootstrap.generation,
				action: "prompt",
				text: "fresh context",
			}),
		});
		assert.equal(result.status, 202);
		assert.deepEqual(current.sent, ["prompt:fresh context"]);
	}
	await reader.cancel();
	await current.command("stop");
	assert.ok(runtime.identity() === undefined, "stop revokes identity");
	await assert.rejects(fetch(`${identity.origin}/bootstrap`, { headers }));
	await current.command(`start ${await port()}`);
	assert.ok(
		runtime.identity()!.token !== identity.token,
		"restart rotates token",
	);
	await current.emit("session_shutdown", { reason: "quit" });
	assert.ok(runtime.identity() === undefined, "quit revokes identity");
});
