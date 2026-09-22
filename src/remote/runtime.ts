import { randomBytes, timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import {
	call,
	content,
	fit,
	header,
	MESSAGE_LIMIT,
	SNAPSHOT_LIMIT,
	message,
	record,
	settle,
	text,
	transcript,
	type Header,
	type Message,
	type ToolBlock,
} from "./projection.ts";

export type Binding = {
	id: string;
	name: string;
	entries: unknown[];
	idle(): boolean;
	header(): Partial<Header>;
	send(text: string, mode: "prompt" | "steer" | "followUp"): void;
	abort(): void;
};
export type Assets = Readonly<Record<string, { type: string; body: string }>>;

const CLIENT_LIMIT = 8;
const VIEW_LIMIT = 4;

export class RemoteRuntime {
	private server?: Server;
	private token?: string;
	private view?: string;
	private origin?: string;
	private starting?: Promise<void>;
	private stopping?: Promise<void>;
	private owner?: symbol;
	private binding?: Binding;
	private generation = 0;
	private revision = 0;
	private status = "reconnecting";
	private messages: Message[] = [];
	private assistant?: Message;
	private tools: ToolBlock[] = [];
	private clients = new Map<ServerResponse, boolean>();
	private heartbeat?: ReturnType<typeof setInterval>;
	private update?: ReturnType<typeof setTimeout>;
	private assets: Assets = {};

	bind(owner: symbol, binding: Binding) {
		this.owner = owner;
		this.binding = binding;
		this.generation++;
		this.messages = transcript(binding.entries);
		this.assistant = undefined;
		this.tools = [];
		this.status = binding.idle() ? "idle" : "running";
		this.broadcast();
		return this.generation;
	}

	detach(owner: symbol) {
		if (this.owner !== owner) return false;
		this.owner = undefined;
		this.binding = undefined;
		this.status = "reconnecting";
		this.broadcast();
		return true;
	}

	publish(owner: symbol, value: unknown) {
		if (owner !== this.owner) return;
		const event = record(value);
		switch (event.type) {
			case "session_info_changed":
				if (this.binding) this.binding.name = text(event.name, 256) || "Untitled";
				break;
			case "agent_start":
				this.status = "running";
				break;
			case "agent_settled":
				this.status = "idle";
				break;
			case "ui_prompt_start":
				this.status = "waiting for terminal";
				break;
			case "ui_prompt_end":
				this.status = this.binding?.idle() ? "idle" : "running";
				break;
			case "message_start":
			case "message_update":
				if (record(event.message).role === "assistant")
					this.assistant = message(event.message);
				break;
			case "message_end": {
				const projected = message(event.message);
				if (projected)
					this.messages = fit(
						[...this.messages, projected].slice(-MESSAGE_LIMIT),
					);
				if (projected?.role === "assistant") this.assistant = undefined;
				break;
			}
			case "tool_execution_start":
			case "tool_execution_update":
			case "tool_execution_end": {
				const started = call({
					id: event.toolCallId,
					name: event.toolName,
					arguments: event.args,
				});
				const result = record(event.result);
				const tool =
					event.type === "tool_execution_end"
						? settle(started, event.isError, result.content, result.details)
						: {
								...started,
								result: content(record(event.partialResult).content),
							};
				this.tools = [
					...this.tools.filter((item) => item.id !== tool.id),
					tool,
				].slice(-16);
				break;
			}
			default:
				return;
		}
		if (!this.update) this.update = setTimeout(() => this.broadcast(), 100);
	}

	snapshot(control = true) {
		const frame = (transcript: Message[]) => ({
			version: 2,
			control,
			generation: this.generation,
			revision: this.revision,
			session: this.binding
				? { id: text(this.binding.id, 128), name: text(this.binding.name, 256) }
				: null,
			status: this.status,
			header: this.binding ? header(this.binding.header()) : null,
			transcript,
			assistant: this.assistant,
			tools: this.tools,
		});
		const overhead = JSON.stringify(frame([])).length;
		return frame(fit(this.messages, SNAPSHOT_LIMIT - overhead));
	}

	async start(port = 8787, assets: Assets = {}) {
		if (this.stopping) await this.stopping;
		if (this.starting) return this.starting;
		if (this.server) return;
		this.assets = assets;
		this.token = randomBytes(32).toString("hex");
		this.view = randomBytes(32).toString("hex");
		const server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
			void this.handle(req, res).catch(() => {
				if (res.headersSent) res.destroy();
				else this.json(res, 500, { error: "Request failed" });
			});
		});
		server.requestTimeout = 15000;
		server.headersTimeout = 10000;
		server.maxConnections = 32;
		this.starting = new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(port, "127.0.0.1", () => {
				server.removeListener("error", reject);
				const address = server.address();
				if (!address || typeof address === "string")
					return reject(new Error("No listening address"));
				this.server = server;
				this.origin = `http://127.0.0.1:${address.port}`;
				this.heartbeat = setInterval(() => {
					for (const client of this.clients.keys())
						this.write(client, ": heartbeat\n\n");
				}, 15000);
				this.heartbeat.unref();
				resolve();
			});
		});
		try {
			await this.starting;
		} catch (error) {
			this.token = undefined;
			this.view = undefined;
			throw error;
		} finally {
			this.starting = undefined;
		}
	}

	identity() {
		return this.origin && this.token && this.view
			? { origin: this.origin, token: this.token, view: this.view }
			: undefined;
	}

	async stop() {
		if (this.stopping) return this.stopping;
		this.stopping = this.close();
		try {
			await this.stopping;
		} finally {
			this.stopping = undefined;
		}
	}

	private async close() {
		if (this.starting) await this.starting.catch(() => {});
		clearInterval(this.heartbeat);
		clearTimeout(this.update);
		this.update = undefined;
		for (const client of this.clients.keys()) client.destroy();
		this.clients.clear();
		const server = this.server;
		this.server = undefined;
		this.origin = undefined;
		this.token = undefined;
		this.view = undefined;
		if (server) {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	}

	private broadcast() {
		clearTimeout(this.update);
		this.update = undefined;
		this.revision++;
		const frames = new Map(
			[true, false].map((control) => [control, this.frame(control)]),
		);
		for (const [client, control] of this.clients)
			this.write(client, frames.get(control)!);
	}

	private frame(control: boolean) {
		return `event: snapshot\ndata: ${JSON.stringify(this.snapshot(control))}\n\n`;
	}

	private write(client: ServerResponse, frame: string) {
		if (client.writableLength > 1024 * 1024) {
			client.destroy();
			this.clients.delete(client);
		} else client.write(frame);
	}

	private authorize(authorization?: string): boolean | undefined {
		const actual = Buffer.from(authorization ?? "");
		for (const [credential, control] of [
			[this.token, true],
			[this.view, false],
		] as const) {
			if (!credential) continue;
			const expected = Buffer.from(`Bearer ${credential}`);
			if (
				expected.length === actual.length &&
				timingSafeEqual(expected, actual)
			)
				return control;
		}
		return undefined;
	}

	private json(res: ServerResponse, status: number, body: unknown) {
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(body));
	}

	private async handle(req: IncomingMessage, res: ServerResponse) {
		res.setHeader("Cache-Control", "no-store");
		res.setHeader(
			"Content-Security-Policy",
			"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
		);
		res.setHeader("Referrer-Policy", "no-referrer");
		res.setHeader("X-Content-Type-Options", "nosniff");
		if (req.headers.origin) {
			let same = false;
			try {
				same = new URL(req.headers.origin).host === req.headers.host;
			} catch {
				return this.json(res, 403, { error: "Origin rejected" });
			}
			if (!same) return this.json(res, 403, { error: "Origin rejected" });
		}
		const path = req.url ?? "";
		const asset = Object.hasOwn(this.assets, path)
			? this.assets[path]
			: undefined;
		if (req.method === "GET" && asset) {
			res.writeHead(200, { "Content-Type": asset.type });
			res.end(asset.body);
			return;
		}
		const control = this.authorize(req.headers.authorization);
		if (control === undefined)
			return this.json(res, 401, { error: "Unauthorized" });
		if (req.method === "GET" && path === "/bootstrap")
			return this.json(res, 200, this.snapshot(control));
		if (req.method === "GET" && path === "/events") {
			const viewers = [...this.clients.values()].filter((held) => !held).length;
			if (this.clients.size >= CLIENT_LIMIT || (!control && viewers >= VIEW_LIMIT))
				return this.json(res, 429, { error: "Too many clients" });
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"X-Accel-Buffering": "no",
				Connection: "keep-alive",
			});
			this.clients.set(res, control);
			res.on("close", () => this.clients.delete(res));
			this.write(res, this.frame(control));
			return;
		}
		if (req.method !== "POST" || path !== "/command")
			return this.json(res, 404, { error: "Not found" });
		if (!control)
			return this.json(res, 403, { error: "This link is view-only" });
		if (req.headers["content-type"] !== "application/json")
			return this.json(res, 415, { error: "Expected JSON" });
		const owner = this.owner;
		const chunks: Buffer[] = [];
		let size = 0;
		req.setTimeout(10000, () => req.destroy());
		for await (const chunk of req) {
			size += chunk.length;
			if (size > 16384) {
				this.json(res, 413, { error: "Command too large" });
				return;
			}
			chunks.push(chunk);
		}
		let command: Record<string, unknown>;
		try {
			command = record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
		} catch {
			return this.json(res, 400, { error: "Invalid JSON" });
		}
		const { action, generation } = command;
		if (
			typeof action !== "string" ||
			!["prompt", "steer", "followUp", "abort"].includes(action) ||
			!Number.isSafeInteger(generation) ||
			Object.keys(command).some(
				(key) => !["action", "generation", "text"].includes(key),
			) ||
			(action === "abort"
				? command.text !== undefined
				: typeof command.text !== "string" ||
					!command.text.trim() ||
					command.text.length > 8192)
		) {
			return this.json(res, 400, { error: "Invalid command" });
		}
		const binding = this.binding;
		if (!binding) return this.json(res, 503, { error: "Session reconnecting" });
		if (owner !== this.owner || generation !== this.generation)
			return this.json(res, 409, {
				error: "Session changed; resync before sending",
			});
		if (action === "prompt" && !binding.idle())
			return this.json(res, 409, {
				error: "Agent busy; use steer or followUp",
			});
		try {
			if (action === "abort") binding.abort();
			else
				binding.send(
					command.text as string,
					action as "prompt" | "steer" | "followUp",
				);
			this.json(res, 202, { accepted: true });
		} catch {
			this.json(res, 409, { error: "Command not accepted" });
		}
	}
}

const key = Symbol.for("pi.remote.runtime.v1");
export function processRuntime(): RemoteRuntime {
	const host = globalThis as typeof globalThis & { [key]?: RemoteRuntime };
	return (host[key] ??= new RemoteRuntime());
}
