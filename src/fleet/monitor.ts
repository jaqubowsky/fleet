import type { Io } from "./io.ts";
import { taskDir } from "./repositories.ts";
import { agentName } from "./name.ts";
import type { Sandbox } from "./status.ts";

export const SETTLE_MS = 1000;
export const STALL_MS = 20 * 60_000;
export const RING_MS = 15 * 60_000;
export const FAILED_IN_A_ROW = 5;
export const TERMINAL = new Set(["done", "idle"]);
const WAKE = new Set(["done", "idle", "blocked"]);
const FINISHED = new Set(["ready-for-host", "paused", "blocked"]);

export function shouldWake(prev: string | undefined, next: string): boolean {
	if (next === "unknown") return prev === "working";
	if (TERMINAL.has(prev ?? "") && TERMINAL.has(next)) return false;

	return WAKE.has(next);
}

export function stalled(
	entries: { pane: string; status: string; since: number; rang: number }[],
	now: number,
	stallMs: number,
	ringMs: number,
): string[] {
	return entries
		.filter(
			(e) =>
				e.status === "working" &&
				now - e.since >= stallMs &&
				now - e.rang >= ringMs,
		)
		.map((e) => e.pane);
}

export function idleStalled(
	agent: string,
	status: string | undefined,
	silentMs: number,
): boolean {
	return (
		TERMINAL.has(agent) && !FINISHED.has(status ?? "") && silentMs >= STALL_MS
	);
}

export function transition(
	prev: string | undefined,
	next: string,
): string | undefined {
	if (prev === next) return undefined;
	return `${prev ?? "?"} -> ${next}`;
}

export function taskDirOf(
	sandboxes: Pick<Sandbox, "name" | "workspaces">[],
	agent: string,
	io: Io,
): string | undefined {
	const hit = sandboxes.find((s) => agentName(s.name) === agent);
	if (!hit?.workspaces[0]) return undefined;
	return taskDir(hit.workspaces[0], hit.name, io);
}
