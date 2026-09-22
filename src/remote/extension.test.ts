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
		sessionManager: {
			getSessionId: () => {
				active();
				return id;
			},
			getSessionName: () => name,
			getBranch: () => [],
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
	assert.match(await page.text(), /Pi remote/);
	for (const path of [
		"/markdown.js",
		"/vendor/marked.js",
		"/vendor/highlight.js",
		"/vendor/highlight-dark.css",
		"/vendor/highlight-light.css",
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
