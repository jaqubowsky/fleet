import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const STATUS_LOG = "logs/status.jsonl";
export const ACTIVITY = "logs/activity.jsonl";

type StatusChange = { at: string; status?: string; attention?: string; summary?: string; added: string[]; removed: string[] };

function sectionOf(statusMd: string | undefined, name: string): string | undefined {
	return statusMd
		?.replace(/\r\n/g, "\n")
		.split(/^## /m)
		.find((part) => part.startsWith(`${name}\n`))
		?.slice(name.length + 1);
}

export function fieldsOf(statusMd: string | undefined): { status?: string; attention?: string; summary?: string } {
	const header = (name: string) => statusMd?.match(new RegExp(`^${name}: (.*)$`, "m"))?.[1];
	return {
		status: header("status"),
		attention: header("attention"),
		summary: sectionOf(statusMd, "Summary")?.trim() || undefined,
	};
}

export function logLines(statusMd: string | undefined): string[] {
	return sectionOf(statusMd, "Log")?.split("\n").filter((line) => line.startsWith("- ")) ?? [];
}

export function addedLines(lines: string[], before: string[]): string[] {
	const left = new Map<string, number>();
	for (const line of before) left.set(line, (left.get(line) ?? 0) + 1);
	return lines.filter((line) => {
		const count = left.get(line) ?? 0;
		if (count) left.set(line, count - 1);
		return !count;
	});
}

export function changes(jsonl: string | undefined): StatusChange[] {
	return (jsonl ?? "").split("\n").filter(Boolean).map((line) => JSON.parse(line) as StatusChange);
}

function replay(kept: StatusChange[]): Omit<StatusChange, "at" | "added" | "removed"> & { log: string[] } {
	const log = kept.reduce<string[]>((lines, change) => [...addedLines(lines, change.removed), ...change.added], []);
	const { status, attention, summary } = kept.at(-1) ?? {};
	return { status, attention, summary, log };
}

export function snapshot(taskDirectory: string, at = new Date()): StatusChange | undefined {
	let status: string;
	try {
		status = readFileSync(join(taskDirectory, "status.md"), "utf8");
	} catch {
		return undefined;
	}
	const file = join(taskDirectory, STATUS_LOG);
	const before = replay(changes(existsSync(file) ? readFileSync(file, "utf8") : undefined));
	const log = logLines(status);
	const change: StatusChange = { at: at.toISOString(), ...fieldsOf(status), added: addedLines(log, before.log), removed: addedLines(before.log, log) };
	const same = change.status === before.status && change.attention === before.attention && change.summary === before.summary;
	if (same && !change.added.length && !change.removed.length) return undefined;
	mkdirSync(join(taskDirectory, "logs"), { recursive: true });
	appendFileSync(file, `${JSON.stringify(change)}\n`);
	return change;
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
