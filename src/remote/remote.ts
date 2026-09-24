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
	readonly runtime = new RemoteRuntime();
	private watched?: string;
	private readonly revoked = () => this.runtime.endStreams();

	async start(dir: string, port: number, assets: Assets) {
		stored(dir);
		await this.runtime.start(port, assets, () => stored(dir));
		if (this.watched) return;
		this.watched = join(dir, "credentials.json");
		watchFile(this.watched, { interval: 1000, persistent: false }, this.revoked);
	}

	revoke(dir: string) {
		mint(dir);
		this.runtime.endStreams();
	}

	async stop() {
		if (this.watched) unwatchFile(this.watched, this.revoked);
		this.watched = undefined;
		await this.runtime.stop();
	}

	identity() {
		return this.runtime.identity();
	}
}

const key = Symbol.for("pi.remote.v2");
export function processRemote(): Remote {
	const host = globalThis as typeof globalThis & { [key]?: Remote };
	return (host[key] ??= new Remote());
}
