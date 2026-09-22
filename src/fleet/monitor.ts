import { basename } from "node:path";
import { agentName } from "./name.ts";

export type Agent = { name?: string; pane_id?: string; agent_status?: string };
export type SandboxRow = { name: string; workspaces: string[] };

export const SETTLE_MS = 1000;
export const STALL_MS = 20 * 60_000;
export const RING_MS = 15 * 60_000;
export const TERMINAL = new Set(["done", "idle"]);
const WAKE = new Set(["done", "idle", "blocked"]);


export function shouldWake(prev: string | undefined, next: string): boolean {
	if (next === "unknown") return prev === "working";
	if (TERMINAL.has(prev ?? "") && TERMINAL.has(next)) return false;

	return WAKE.has(next);
}

export function pickAgents(
	agents: Agent[],
	wanted: string[],
	selfPane: string,
): Agent[] {
	const others = agents.filter((a) => a.pane_id && a.pane_id !== selfPane);
	if (!wanted.length) return others;
	const names = new Set(wanted.flatMap((w) => [w, agentName(w)]));
	return others.filter(
		(a) => names.has(a.name ?? "") || names.has(a.pane_id ?? ""),
	);
}

export function stalled(
	entries: { pane: string; status: string; since: number; rang: number }[],
	now: number,
	stallMs: number,
	ringMs: number,
): string[] {
	return entries
		.filter((e) => e.status === "working" && now - e.since >= stallMs && now - e.rang >= ringMs)
		.map((e) => e.pane);
}

export function transition(
	prev: string | undefined,
	next: string,
): string | undefined {
	if (prev === next) return undefined;
	return `${prev ?? "?"} -> ${next}`;
}

export function taskDirOf(
	home: string,
	sandboxes: SandboxRow[],
	agent: string,
): string | undefined {
	const hit = sandboxes.find((s) => agentName(s.name) === agent);
	if (!hit?.workspaces[0]) return undefined;
	return `${home}/.sandboxes/${basename(hit.workspaces[0])}/${hit.name}`;
}
