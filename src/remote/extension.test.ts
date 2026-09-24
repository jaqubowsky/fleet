import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import remoteExtension, {
	type Context,
	type RemoteAPI,
	type Widget,
} from "../../extensions/pi-remote/index.ts";
import { processRemote } from "./remote.ts";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-agent-"));

const keys = () => ({ control: "a".repeat(64), view: "b".repeat(64) });

function settings(t: TestContext, value: unknown) {
	const file = join(process.env.PI_CODING_AGENT_DIR!, "settings.json");
	writeFileSync(file, JSON.stringify(value));
	t.after(() => rmSync(file, { force: true }));
}

async function port() {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	await new Promise<void>((resolve) => server.close(() => resolve()));
	return address.port;
}

function session(id: string, mode = "tui") {
	const handlers = new Map<string, Parameters<RemoteAPI["on"]>[1]>();
	let command: Parameters<RemoteAPI["registerCommand"]>[1];
	const sent: string[] = [];
	const notices: string[] = [];
	let widget: Widget | undefined;
	let marker: string | undefined;
	let stale = false;
	let name = id;
	const active = () => {
		assert.equal(stale, false, "old session is never accessed");
	};
	const context: Context = {
		mode,
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
			setStatus: (key, text) => {
				active();
				assert.equal(key, "pi-remote");
				marker = text;
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
		marker: () => marker,
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
	const { runtime } = processRemote();
	const current = session("running");
	t.after(() => current.emit("session_shutdown", { reason: "quit" }));
	await current.emit("session_start");
	await runtime.start(0, {}, keys);
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
	const { runtime } = processRemote();
	const current = session("bash-result");
	t.after(async () => {
		await current.emit("session_shutdown", { reason: "quit" });
		await runtime.stop();
	});
	await current.emit("session_start");
	await runtime.start(0, {}, keys);
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
	const remote = processRemote();
	t.after(() => remote.stop());
	let current = session("original");
	await current.emit("session_start", { reason: "startup" });
	await current.command(`start ${await port()}`);
	const identity = remote.identity();
	assert.ok(identity);
	const headers = { Authorization: `Bearer ${identity.token}` };
	const initial = await fetch(`${identity.session}/bootstrap`, { headers });
	assert.equal(initial.status, 200);
	assert.equal((await initial.json()).session.id, "original");
	const page = await fetch(`${identity.session}/`);
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
		const library: Response = await fetch(identity.session + path);
		assert.equal(library.status, 200, `${path} is public`);
		assert.ok((await library.text()).length > 0, `${path} has a body`);
	}
	assert.equal(
		(await fetch(`${identity.session}/vendor/anything-else.js`)).status,
		401,
		"only the listed assets are public",
	);
	const dashboard = await fetch(`${identity.origin}/`);
	assert.match(await dashboard.text(), /Sessions/);
	for (const path of ["/dashboard.js", "/client.css", "/connection.js", "/manifest.webmanifest", "/icon.svg"])
		assert.equal((await fetch(identity.origin + path)).status, 200, `${path} is public on the hub`);
	const proxied = new URL(`/s/${remote.id}/`, identity.origin);
	const html = await (await fetch(proxied)).text();
	const script = await (await fetch(new URL("client.js", proxied))).text();
	for (const [reference, base] of [
		...[...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => [match[1], proxied] as const),
		...[...script.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => [match[1], new URL("client.js", proxied)] as const),
	]) {
		if (reference === "../../") continue;
		const url = new URL(reference, base);
		assert.ok(url.pathname.startsWith(proxied.pathname), `${reference} stays under the session's prefix`);
		assert.equal((await fetch(url)).status, 200, `${reference} loads through the hub`);
	}
	const stream = await fetch(`${identity.session}/events`, { headers });
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
	assert.ok(widgetLines.join("").includes(`${identity.origin}/#${identity.token}`), "the link opens Sessions");
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
	assert.match(current.notices.at(-1)!, /served by this pi/);

	for (const reason of ["new", "resume", "fork", "reload"]) {
		const old = current;
		await old.emit("session_shutdown", { reason });
		old.retire();
		current = session(reason);
		await current.emit("session_start", { reason });
		const reimported = await import(`./remote.ts?${reason}`);
		assert.equal(reimported.processRemote(), remote);
		assert.ok(
			remote.identity()?.token === identity.token &&
				remote.identity()?.origin === identity.origin,
			"factory replacement preserves identity",
		);
		await old.emit("session_shutdown", { reason: "quit" });
		assert.ok(
			remote.identity()?.token === identity.token &&
				remote.identity()?.origin === identity.origin,
			"stale quit preserves identity",
		);
		const bootstrap = await (
			await fetch(`${identity.session}/bootstrap`, { headers })
		).json();
		assert.equal(bootstrap.session.id, reason);
		const result: Response = await fetch(`${identity.session}/command`, {
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
	assert.ok(remote.identity() === undefined, "stop closes the listener");
	await assert.rejects(fetch(`${identity.session}/bootstrap`, { headers }));
	await current.command(`start ${await port()}`);
	assert.equal(remote.identity()!.token, identity.token, "restart keeps the link");
	await current.command("link");
	await current.command("revoke");
	assert.ok(current.widget() === undefined, "revoke hides the old link");
	assert.notEqual(remote.identity()!.token, identity.token, "revoke rotates the link");
	assert.equal(
		(await fetch(`${remote.identity()!.session}/bootstrap`, { headers })).status,
		401,
		"the old link is refused",
	);
	await current.emit("session_shutdown", { reason: "quit" });
	assert.ok(remote.identity() === undefined, "quit closes the listener");
});

test("a host pi joins remote control at startup without a word", async (t) => {
	const hub = await port();
	settings(t, { remote: { autoStart: true, port: hub } });
	const remote = processRemote();
	t.after(() => remote.stop());
	const current = session("startup");

	await current.emit("session_start", { reason: "startup" });

	assert.equal(remote.identity()?.origin, `http://127.0.0.1:${hub}`);
	assert.equal(current.widget(), undefined);
	assert.deepEqual(current.notices, []);
});

test("an autostart that fails says so once", async (t) => {
	settings(t, { remote: { autoStart: true, port: await port() } });
	const credentials = join(process.env.PI_CODING_AGENT_DIR!, "remote", "credentials.json");
	mkdirSync(join(credentials, ".."), { recursive: true });
	writeFileSync(credentials, "{}");
	t.after(() => rmSync(credentials, { force: true }));
	const current = session("failing");

	await current.emit("session_start", { reason: "startup" });

	assert.equal(processRemote().identity(), undefined);
	assert.equal(current.notices.length, 1);
	assert.match(current.notices[0], /Remote failed to start: Invalid remote credentials/);
});

test("reload, other modes and autoStart off leave remote control to /remote start", async (t) => {
	const remote = processRemote();
	t.after(() => remote.stop());
	const cases = [
		[true, "reload", "tui"],
		[true, "startup", "rpc"],
		[true, "startup", "print"],
		[false, "startup", "tui"],
	] as const;

	for (const [autoStart, reason, mode] of cases) {
		settings(t, { remote: { autoStart, port: await port() } });
		const current = session(`${reason}-${mode}`, mode);
		await current.emit("session_start", { reason });
		assert.equal(remote.identity(), undefined, `${reason} in ${mode}, autoStart ${autoStart}`);
		assert.equal(current.marker(), undefined, "no marker while remote is off");
	}
	const hub = await port();
	settings(t, { remote: { port: hub } });
	await session("manual").command("start");

	assert.equal(remote.identity()?.origin, `http://127.0.0.1:${hub}`, "start takes the configured port");
});

test("a malformed remote setting stops the extension from loading", (t) => {
	for (const remote of [{ port: 70000 }, { port: "8787" }, { autoStart: "yes" }]) {
		settings(t, { remote });
		assert.throws(() => session("malformed"), /remote\./, JSON.stringify(remote));
	}
	for (const remote of [true, 8787]) {
		settings(t, { remote });
		assert.throws(() => session("malformed"), /remote must be an object/, JSON.stringify(remote));
	}
});

test("the footer marker counts the phones watching this session", { timeout: 10000 }, async (t) => {
	settings(t, { remote: { autoStart: true, port: await port() } });
	const remote = processRemote();
	t.after(() => remote.stop());
	const first = session("marked");
	await first.emit("session_start", { reason: "startup" });
	const { session: origin, token } = remote.identity()!;
	const quiet = first.marker();
	const reader = (await fetch(`${origin}/events`, { headers: { Authorization: `Bearer ${token}` } })).body!.getReader();
	await reader.read();
	const watched = first.marker();
	await reader.cancel();
	const deadline = Date.now() + 3000;
	while (first.marker() !== "⌁ remote" && Date.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 20));
	const left = first.marker();

	await first.emit("session_shutdown", { reason: "new" });
	first.retire();
	const next = session("next");
	await next.emit("session_start", { reason: "new" });
	const replaced = next.marker();
	const phone = (await fetch(`${origin}/events`, { headers: { Authorization: `Bearer ${token}` } })).body!.getReader();
	await phone.read();
	await next.command("stop");

	assert.deepEqual([quiet, watched, left, replaced, next.marker()], [
		"⌁ remote",
		"⌁ remote 1",
		"⌁ remote",
		"⌁ remote",
		undefined,
	]);
});
