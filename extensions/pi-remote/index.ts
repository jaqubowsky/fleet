import { readFileSync } from "node:fs";
import qrcode from "qrcode-terminal";
import { processRuntime } from "../../src/remote/runtime.ts";
import { inspectServe } from "../../src/remote/tailscale.ts";

export type Widget =
	| string[]
	| ((
			tui: unknown,
			theme: unknown,
	  ) => { render(width: number): string[]; invalidate(): void });

export type Context = {
	mode: string;
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

export default function remoteExtension(pi: RemoteAPI) {
	const runtime = processRuntime();
	let owner = Symbol("remote binding");
	function bind(ctx: Context) {
		owner = Symbol("remote binding");
		runtime.bind(owner, {
			id: ctx.sessionManager.getSessionId(),
			name: ctx.sessionManager.getSessionName() ?? "Untitled",
			entries: ctx.sessionManager.getBranch(),
			idle: () => ctx.isIdle(),
			abort: () => ctx.abort(),
			send: (text, mode) =>
				pi.sendUserMessage(
					text,
					mode === "prompt" ? undefined : { deliverAs: mode },
				),
		});
	}
	pi.on("session_start", (_event, ctx) => bind(ctx));
	pi.on("session_shutdown", async (event, ctx) => {
		if (!runtime.detach(owner)) return;
		if (ctx.mode === "tui") ctx.ui.setWidget("pi-remote", undefined);
		if (event.reason === "quit") await runtime.stop();
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
		description: "Remote control: start [port], stop, status, link, help",
		handler: async (args, ctx) => {
			const [action = "help", portText, ...rest] = args.trim().split(/\s+/);
			if (ctx.mode === "tui") ctx.ui.setWidget("pi-remote", undefined);
			if (rest.length || (portText && action !== "start")) {
				ctx.ui.notify("Use /remote help", "warning");
				return;
			}
			if (action === "stop") {
				await runtime.stop();
				ctx.ui.setWidget("pi-remote", undefined);
				ctx.ui.notify("Remote stopped. Existing links are revoked.");
				return;
			}
			if (action === "start") {
				const port = portText === undefined ? 8787 : Number(portText);
				if (!Number.isInteger(port) || port < 1 || port > 65535) {
					ctx.ui.notify("Port must be 1..65535", "error");
					return;
				}
				const asset = (file: string, type: string) => ({
					type,
					body: readFileSync(new URL(file, import.meta.url), "utf8"),
				});
				try {
					await runtime.start(port, {
						"/": asset("client.html", "text/html; charset=utf-8"),
						"/client.js": asset("client.js", "text/javascript; charset=utf-8"),
						"/client.css": asset("client.css", "text/css; charset=utf-8"),
					});
				} catch {
					ctx.ui.notify(
						"Remote failed to start. Check the port and installed client files.",
						"error",
					);
					return;
				}
			} else if (action !== "status" && action !== "link") {
				ctx.ui.notify(
					"/remote start [port] | stop | status | link\nDefault port 8787. Tailscale Serve is configured manually. Link shows a private QR in this terminal. Treat it as a password. Remote input can run tools with this process's permissions. Only stop or process exit ends remote control.",
				);
				return;
			}
			const identity = runtime.identity();
			if (!identity) {
				ctx.ui.notify("Remote stopped. Use /remote start.");
				return;
			}
			const serve = await inspectServe(identity.origin);
			ctx.ui.notify(
				`Remote listening at ${identity.origin}. ${serve.url ? `Serve: ${serve.url}` : `Serve ${serve.available ? "not configured for this port" : "unavailable"}. One-time command:\n${serve.command}`}`,
			);
			if (action !== "link") return;
			if (ctx.mode !== "tui") {
				ctx.ui.notify(
					"Private links are shown only in the terminal UI.",
					"warning",
				);
				return;
			}
			const url = `${serve.url ?? identity.origin}/#${identity.token}`;
			qrcode.generate(url, { small: true }, (code) => {
				const lines = [
					serve.url
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
