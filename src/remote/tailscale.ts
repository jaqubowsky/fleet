import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { record } from "./projection.ts";

export const tailscale = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
export function serveInfo(
	config: unknown,
	origin: string,
): { command: string; url?: string } {
	const command = `'${tailscale}' serve --bg --https=443 ${origin}`;
	const root = record(config);
	for (const [host, value] of Object.entries(record(root.Web))) {
		if (!/^[a-z0-9.-]+\.ts\.net:443$/.test(host)) continue;
		const proxy = record(record(record(value).Handlers)["/"]).Proxy;
		if (
			proxy === origin &&
			record(record(root.TCP)["443"]).HTTPS === true &&
			record(root.AllowFunnel)[host] !== true
		) {
			return { command, url: `https://${host.slice(0, -4)}` };
		}
	}
	return { command };
}

export async function inspectServe(origin: string) {
	try {
		const { stdout } = await promisify(execFile)(
			tailscale,
			["serve", "status", "--json"],
			{ timeout: 5000, maxBuffer: 65536 },
		);
		return { ...serveInfo(JSON.parse(stdout), origin), available: true };
	} catch {
		return { ...serveInfo({}, origin), available: false };
	}
}
