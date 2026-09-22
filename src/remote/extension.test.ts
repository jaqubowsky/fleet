import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import remoteExtension, {
	type Context,
	type RemoteAPI,
} from "../../agent/extensions/pi-remote/index.ts";
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
	let widget: string[] | undefined;
	let stale = false;
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
			getSessionName: () => id,
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
		command: (args: string) => command.handler(args, context),
		emit: (type: string, fields = {}) =>
			handlers.get(type)?.({ type, ...fields }, context),
		retire: () => {
			stale = true;
		},
	};
}

test(
	"extension controls a process runtime across fresh factories",
	{ timeout: 15000 },
	async (t) => {
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
		const page = await fetch(identity.origin);
		assert.equal(page.status, 200);
		assert.match(
			page.headers.get("content-security-policy")!,
			/default-src 'none'/,
		);
		assert.match(await page.text(), /Pi remote/);
		const stream = await fetch(`${identity.origin}/events`, { headers });
		const reader = stream.body!.getReader();
		t.after(() => reader.cancel());
		assert.match(
			new TextDecoder().decode((await reader.read()).value),
			/original/,
		);
		await current.command("link");
		assert.ok(
			current.widget()?.some((line) => line.includes(`#${identity.token}`)),
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
	},
);
