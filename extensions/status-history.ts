import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const HISTORY = "logs/status";
export const ACTIVITY = "logs/activity.jsonl";

const VERSION = /^(\d+)-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.md$/;

const two = (n: number) => String(n).padStart(2, "0");

function stamp(at: Date): string {
	return `${at.getUTCFullYear()}${two(at.getUTCMonth() + 1)}${two(at.getUTCDate())}T${two(at.getUTCHours())}${two(at.getUTCMinutes())}${two(at.getUTCSeconds())}Z`;
}

export function versions(names: string[]): { name: string; number: number; at: string }[] {
	return names
		.flatMap((name) => {
			const match = name.match(VERSION);
			if (!match) return [];
			const [, number, ...parts] = match.map(Number);
			const [y, mo, d, h, mi, s] = parts;
			const at = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
			return [{ name, number, at: `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}` }];
		})
		.sort((a, b) => a.number - b.number);
}

export function snapshot(taskDirectory: string, at = new Date()): string | undefined {
	let status: string;
	try {
		status = readFileSync(join(taskDirectory, "status.md"), "utf8");
	} catch {
		return undefined;
	}
	const dir = join(taskDirectory, HISTORY);
	mkdirSync(dir, { recursive: true });
	const last = versions(readdirSync(dir)).at(-1);
	if (last && readFileSync(join(dir, last.name), "utf8") === status) return undefined;
	const name = `${String((last?.number ?? 0) + 1).padStart(3, "0")}-${stamp(at)}.md`;
	writeFileSync(join(dir, name), status);
	return name;
}

export function record(taskDirectory: string, call: { tool: string; ok: boolean; agent?: string }, at = new Date()): void {
	mkdirSync(join(taskDirectory, "logs"), { recursive: true });
	appendFileSync(join(taskDirectory, ACTIVITY), `${JSON.stringify({ at: at.toISOString(), tool: call.tool, ok: call.ok, agent: call.agent ?? "main" })}\n`);
}

export default function (pi: any) {
	if (!process.env.FLEET_ARTIFACTS || !process.env.SANDBOX_NAME) return;
	const taskDirectory = join(process.env.FLEET_ARTIFACTS, process.env.SANDBOX_NAME);
	pi.on("tool_execution_end", (event: { toolName: string; isError: boolean }) => {
		record(taskDirectory, { tool: event.toolName, ok: !event.isError });
		snapshot(taskDirectory);
	});
}
