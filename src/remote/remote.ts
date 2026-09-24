import { randomBytes } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	unwatchFile,
	watchFile,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Hub, register, unregister } from "./hub.ts";
import { RemoteRuntime, type Assets, type Credentials } from "./runtime.ts";

const CREDENTIAL = /^[a-f0-9]{64}$/;

function mint(dir: string): Credentials {
	const credentials = {
		control: randomBytes(32).toString("hex"),
		view: randomBytes(32).toString("hex"),
	};
	const file = join(dir, "credentials.json");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	writeFileSync(`${file}.${process.pid}`, JSON.stringify(credentials), {
		mode: 0o600,
	});
	renameSync(`${file}.${process.pid}`, file);
	return credentials;
}

function stored(dir: string): Credentials {
	const file = join(dir, "credentials.json");
	let credentials;
	try {
		credentials = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return mint(dir);
		throw error;
	}
	if (!CREDENTIAL.test(credentials?.control) || !CREDENTIAL.test(credentials?.view))
		throw new Error(`Invalid remote credentials: ${file}`);
	return credentials;
}

export class Remote {
	readonly id = randomBytes(8).toString("hex");
	readonly runtime = new RemoteRuntime();
	private hub?: Hub;
	private dir?: string;
	private watched?: string;
	private readonly revoked = () => this.runtime.endStreams();

	async start(dir: string, port: number, assets: { session: Assets; hub: Assets }) {
		const keys = () => stored(dir);
		keys();
		await this.runtime.start(0, assets.session, keys);
		if (this.hub) return;
		this.dir = dir;
		register(dir, this.id, this.runtime.port!);
		this.hub = new Hub(port, dir, assets.hub, keys);
		this.watched = join(dir, "credentials.json");
		watchFile(this.watched, { interval: 1000, persistent: false }, this.revoked);
		await this.hub.claim();
	}

	revoke(dir: string) {
		mint(dir);
		this.runtime.endStreams();
	}

	async stop() {
		if (this.watched) unwatchFile(this.watched, this.revoked);
		this.watched = undefined;
		if (this.dir) unregister(this.dir, this.id);
		const hub = this.hub;
		this.hub = undefined;
		await Promise.all([hub?.release(), this.runtime.stop()]);
	}

	identity() {
		const session = this.runtime.identity();
		if (!session || !this.hub) return undefined;
		return {
			origin: `http://127.0.0.1:${this.hub.port}`,
			session: session.origin,
			token: session.token,
			view: session.view,
			hub: this.hub.serving,
		};
	}
}

const key = Symbol.for("pi.remote.v2");
export function processRemote(): Remote {
	const host = globalThis as typeof globalThis & { [key]?: Remote };
	return (host[key] ??= new Remote());
}
