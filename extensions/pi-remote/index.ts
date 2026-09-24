import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import qrcode from "qrcode-terminal";
import { processRemote } from "../../src/remote/remote.ts";
import { inspectServe } from "../../src/remote/tailscale.ts";

export type Widget =
	| string[]
	| ((
			tui: unknown,
			theme: unknown,
	  ) => { render(width: number): string[]; invalidate(): void });

export type Context = {
	mode: string;
	cwd?: string;
	model?: { id?: string; name?: string };
	getContextUsage?(): { percent: number | null } | undefined;
	hasPendingMessages?(): boolean;
	sessionManager: {
		getSessionId(): string;
		getSessionName(): string | undefined;
		getBranch(): unknown[];
	};
	isIdle(): boolean;
	abort(): void;
	ui: {
		notify(text: string, level?: "info" | "warning" | "error"): void;
		setWidget(key: string, content: Widget | undefined): void;
		setStatus(key: string, text: string | undefined): void;
	};
};
type Event = { type: string; reason?: string };
export type RemoteAPI = {
	on(
		name: string,
		handler: (event: Event, context: Context) => void | Promise<void>,
	): void;
	registerCommand(
		name: string,
		command: {
			description: string;
			handler(args: string, context: Context): Promise<void>;
		},
	): void;
	sendUserMessage(
		text: string,
		options?: { deliverAs: "steer" | "followUp" },
	): void;
};

function spent(entries: unknown[]): number | undefined {
	let total = 0;
	let seen = false;
	for (const entry of entries) {
		const cost = (
			entry as { message?: { usage?: { cost?: { total?: unknown } } } }
		)?.message?.usage?.cost?.total;
		if (typeof cost === "number" && Number.isFinite(cost)) {
			total += cost;
			seen = true;
		}
	}
	return seen ? total : undefined;
}

function agentHome() {
	return (
		process.env.PI_CODING_AGENT_DIR?.replace(/^~(?=\/|$)/, homedir()) ||
		join(homedir(), ".pi", "agent")
	);
}

function assets() {
	const JS = "text/javascript; charset=utf-8";
	const CSS = "text/css; charset=utf-8";
	const asset = (file: string, type: string) => ({
		type,
		body: readFileSync(new URL(file, import.meta.url), "utf8"),
	});
	const vendor = (specifier: string, type: string) => ({
		type,
		body: readFileSync(createRequire(import.meta.url).resolve(specifier), "utf8"),
	});
	const shared = {
		"/client.css": asset("client.css", CSS),
		"/connection.js": asset("connection.js", JS),
		"/manifest.webmanifest": asset(
			"manifest.webmanifest",
			"application/manifest+json; charset=utf-8",
		),
		"/icon.svg": asset("icon.svg", "image/svg+xml; charset=utf-8"),
	};
	return {
		session: {
			...shared,
			"/": asset("client.html", "text/html; charset=utf-8"),
			"/client.js": asset("client.js", JS),
			"/markdown.js": asset("markdown.js", JS),
			"/vendor/marked.js": vendor("marked", JS),
			"/vendor/highlight.js": vendor("@highlightjs/cdn-assets/es/highlight.min.js", JS),
			"/vendor/highlight-dark.css": vendor(
				"@highlightjs/cdn-assets/styles/github-dark.min.css",
				CSS,
			),
			"/vendor/highlight-light.css": vendor(
				"@highlightjs/cdn-assets/styles/github.min.css",
				CSS,
			),
		},
		hub: {
			...shared,
			"/": asset("dashboard.html", "text/html; charset=utf-8"),
			"/dashboard.js": asset("dashboard.js", JS),
		},
	};
}

function settings(home: string) {
	const file = join(home, "settings.json");
	let value;
	try {
		value = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			throw new Error(`Cannot read remote settings: ${file}`, { cause: error });
	}
	const remote = value?.remote ?? {};
	if (typeof remote !== "object" || Array.isArray(remote))
		throw new Error("remote must be an object");
	const { autoStart = false, port = 8787 } = remote;
	if (typeof autoStart !== "boolean")
		throw new Error("remote.autoStart must be true or false");
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw new Error("remote.port must be an integer in 1..65535");
	return { autoStart, port };
}

export default function remoteExtension(pi: RemoteAPI) {
	const remote = processRemote();
	const { runtime } = remote;
	const home = agentHome();
	const configured = settings(home);
	const dir = join(home, "remote");
	let owner = Symbol("remote binding");
	function bind(ctx: Context) {
		owner = Symbol("remote binding");
		runtime.bind(owner, {
			id: ctx.sessionManager.getSessionId(),
			name: ctx.sessionManager.getSessionName() ?? "Untitled",
			entries: ctx.sessionManager.getBranch(),
			idle: () => ctx.isIdle(),
			header: () => ({
				cwd: ctx.cwd,
				model: ctx.model?.name ?? ctx.model?.id,
				percent: ctx.getContextUsage?.()?.percent ?? undefined,
				cost: spent(ctx.sessionManager.getBranch()),
				queued: ctx.hasPendingMessages?.() ?? false,
			}),
			abort: () => ctx.abort(),
			listening: (phones) =>
				ctx.ui.setStatus(
					"pi-remote",
					phones === undefined ? undefined : phones ? `⌁ remote ${phones}` : "⌁ remote",
				),
			send: (text, mode) =>
				pi.sendUserMessage(
					text,
					mode === "prompt" ? undefined : { deliverAs: mode },
				),
		});
	}
	pi.on("session_start", async (event, ctx) => {
		bind(ctx);
		if (!configured.autoStart || event.reason !== "startup" || ctx.mode !== "tui")
			return;
		try {
			await remote.start(dir, configured.port, assets());
		} catch (error) {
			ctx.ui.notify(`Remote failed to start: ${(error as Error).message}`, "error");
		}
	});
	pi.on("session_shutdown", async (event, ctx) => {
		if (!runtime.detach(owner)) return;
		if (ctx.mode === "tui") ctx.ui.setWidget("pi-remote", undefined);
		if (event.reason === "quit") await remote.stop();
	});
	for (const name of [
		"agent_start",
		"agent_settled",
		"session_info_changed",
		"ui_prompt_start",
		"ui_prompt_end",
		"message_start",
		"message_update",
		"message_end",
		"tool_execution_start",
		"tool_execution_update",
		"tool_execution_end",
	]) {
		pi.on(name, (event) => runtime.publish(owner, event));
	}
	for (const name of ["session_tree", "session_compact"])
		pi.on(name, (_event, ctx) => bind(ctx));
	pi.registerCommand("remote", {
		description: "Remote control: start [port], stop, status, link, revoke, help",
		handler: async (args, ctx) => {
			const [action = "help", argument, ...rest] = args.trim().split(/\s+/);
			if (ctx.mode === "tui") ctx.ui.setWidget("pi-remote", undefined);
			const viewOnly = action === "link" && argument === "--view";
			if (rest.length || (argument && action !== "start" && !viewOnly)) {
				ctx.ui.notify("Use /remote help", "warning");
				return;
			}
			if (action === "stop") {
				await remote.stop();
				ctx.ui.setWidget("pi-remote", undefined);
				ctx.ui.notify("Remote stopped. Links stay valid until /remote revoke.");
				return;
			}
			if (action === "revoke") {
				remote.revoke(dir);
				ctx.ui.notify("Links revoked. Phones need the new /remote link.");
				return;
			}
			if (action === "start") {
				const port = argument === undefined ? configured.port : Number(argument);
				if (!Number.isInteger(port) || port < 1 || port > 65535) {
					ctx.ui.notify("Port must be 1..65535", "error");
					return;
				}
				try {
					await remote.start(dir, port, assets());
				} catch (error) {
					ctx.ui.notify(
						`Remote failed to start: ${(error as Error).message}`,
						"error",
					);
					return;
				}
			} else if (action !== "status" && action !== "link") {
				ctx.ui.notify(
					"/remote start [port] | stop | status | link [--view] | revoke\nThe port, remote.port in settings (8787 by default), serves Sessions: every started pi, whichever pi holds the port, and another takes it over when that pi quits. Tailscale Serve is configured manually. Link shows a private QR in this terminal; --view shows the link that watches without controlling. Treat both as passwords: they stay valid across stop and restart until revoke replaces them. Remote input can run tools with this process's permissions. Stop or process exit ends remote control for this session.",
				);
				return;
			}
			const identity = remote.identity();
			if (!identity) {
				ctx.ui.notify("Remote stopped. Use /remote start.");
				return;
			}
			const serve = await inspectServe(identity.origin);
			ctx.ui.notify(
				`Remote listening at ${identity.session}. Sessions at ${identity.origin}, ${identity.hub ? "served by this pi" : "served by another process"}. ${serve.url ? `Serve: ${serve.url}` : `Serve ${serve.available ? "not configured for this port" : "unavailable"}. One-time command:\n${serve.command}`}`,
			);
			if (action !== "link") return;
			if (ctx.mode !== "tui") {
				ctx.ui.notify(
					"Private links are shown only in the terminal UI.",
					"warning",
				);
				return;
			}
			const url = `${serve.url ?? identity.origin}/#${viewOnly ? identity.view : identity.token}`;
			qrcode.generate(url, { small: true }, (code) => {
				const lines = [
					viewOnly
						? "View only. This link watches and cannot send."
						: serve.url
							? "Scan on your tailnet phone"
							: "Loopback only. Configure Tailscale Serve for phone access.",
					...code.trimEnd().split("\n"),
					url,
					"Run /remote status to hide this credential.",
				];
				ctx.ui.setWidget("pi-remote", () => ({
					render(width) {
						const limit = Math.max(1, width - 2);
						return lines.flatMap((line) => {
							if (line.length <= limit) return [line];
							const chunks: string[] = [];
							for (let offset = 0; offset < line.length; offset += limit)
								chunks.push(line.slice(offset, offset + limit));
							return chunks;
						});
					},
					invalidate() {},
				}));
			});
		},
	});
}
