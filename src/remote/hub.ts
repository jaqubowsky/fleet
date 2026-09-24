import {
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {
	request,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { join } from "node:path";
import {
	asset,
	authorize,
	guard,
	json,
	listener,
	type Assets,
	type Credentials,
} from "./runtime.ts";

const ID = /^[a-f0-9]{16}$/;
const PROXIED = /^\/s\/([a-f0-9]{16})(\/.*)?$/;

type Entry = { id: string; port: number };

export function register(dir: string, id: string, port: number) {
	mkdirSync(join(dir, "sessions"), { recursive: true, mode: 0o700 });
	writeFileSync(
		join(dir, "sessions", `${id}.json`),
		JSON.stringify({ port, pid: process.pid }),
		{ mode: 0o600 },
	);
}

export function unregister(dir: string, id: string) {
	rmSync(join(dir, "sessions", `${id}.json`), { force: true });
}

function alive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function entry(dir: string, id: string): Entry | undefined {
	const file = join(dir, "sessions", `${id}.json`);
	let value;
	try {
		value = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
	const { port, pid } = value ?? {};
	if (!Number.isInteger(port) || !Number.isInteger(pid) || pid <= 0)
		return undefined;
	if (alive(pid)) return { id, port };
	rmSync(file, { force: true });
	return undefined;
}

function entries(dir: string): Entry[] {
	let names: string[];
	try {
		names = readdirSync(join(dir, "sessions"));
	} catch {
		return [];
	}
	return names.flatMap((name) => {
		const id = name.slice(0, -".json".length);
		const found = name.endsWith(".json") && ID.test(id) && entry(dir, id);
		return found ? [found] : [];
	});
}

export class Hub {
	private server?: Server;
	private retry?: ReturnType<typeof setTimeout>;

	readonly port: number;
	private readonly dir: string;
	private readonly assets: Assets;
	private readonly keys: () => Credentials;

	constructor(port: number, dir: string, assets: Assets, keys: () => Credentials) {
		this.port = port;
		this.dir = dir;
		this.assets = assets;
		this.keys = keys;
	}

	get serving() {
		return this.server?.listening ?? false;
	}

	claim() {
		return new Promise<void>((settled) => {
			const server = listener((req, res) => this.handle(req, res));
			this.server = server;
			server.once("error", () => {
				settled();
				if (this.server !== server || server.listening) return;
				this.retry = setTimeout(() => this.claim(), 1000);
				this.retry.unref();
			});
			server.listen(this.port, "127.0.0.1", () => {
				settled();
				if (this.server !== server) server.close();
			});
		});
	}

	async release() {
		clearTimeout(this.retry);
		const server = this.server;
		this.server = undefined;
		if (!server?.listening) return;
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}

	private async handle(req: IncomingMessage, res: ServerResponse) {
		if (!guard(req, res)) return;
		const path = req.url ?? "";
		const proxied = PROXIED.exec(path);
		if (proxied?.[2]) return this.proxy(req, res, proxied[1], proxied[2]);
		if (proxied) {
			res.writeHead(308, { Location: `${path}/` });
			res.end();
			return;
		}
		if (asset(req, res, this.assets)) return;
		const authorization = req.headers.authorization;
		if (authorize(authorization, this.keys()) === undefined)
			return json(res, 401, { error: "Unauthorized" });
		if (req.method === "GET" && path === "/sessions")
			return json(res, 200, { sessions: await this.sessions(authorization!) });
		return json(res, 404, { error: "Not found" });
	}

	private async sessions(authorization: string) {
		const found = await Promise.all(
			entries(this.dir).map(async ({ id, port }) => {
				try {
					const response = await fetch(`http://127.0.0.1:${port}/summary`, {
						headers: { Authorization: authorization },
						signal: AbortSignal.timeout(2000),
					});
					return response.ok ? [{ id, ...(await response.json()) }] : [];
				} catch {
					return [];
				}
			}),
		);
		return found
			.flat()
			.sort((a, b) =>
				(a.session?.name ?? "").localeCompare(b.session?.name ?? ""),
			);
	}

	private proxy(
		req: IncomingMessage,
		res: ServerResponse,
		id: string,
		path: string,
	) {
		const target = entry(this.dir, id);
		if (!target) return json(res, 404, { error: "Session ended" });
		const upstream = request(
			{
				host: "127.0.0.1",
				port: target.port,
				method: req.method,
				path,
				headers: req.headers,
			},
			(response) => {
				const {
					connection: _connection,
					"keep-alive": _keepAlive,
					"transfer-encoding": _encoding,
					...headers
				} = response.headers;
				res.writeHead(response.statusCode ?? 502, headers);
				response.on("error", () => res.destroy());
				response.pipe(res);
			},
		);
		upstream.on("error", () => {
			if (res.headersSent) res.destroy();
			else json(res, 502, { error: "Session unreachable" });
		});
		res.on("close", () => upstream.destroy());
		req.pipe(upstream);
	}
}
