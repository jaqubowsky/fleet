import type { Harness } from "../harness.ts";
import type { Io } from "./io.ts";

export function eventsLog(h: Harness): string {
	return h.owner === "none" ? `${h.home}/${h.cache}/fleet-events.log` : `${h.home}/agent/fleet-events.log`;
}

export function logEvent(io: Io, kind: "up" | "steer" | "down", agent: string, text?: string): void {
	const fields = [io.now().toISOString(), io.pane, kind, agent, `session=${encodeURIComponent(io.sessionId ?? "")}`];
	if (text !== undefined) fields.push(JSON.stringify(text));
	io.append(`${io.home}/${eventsLog(io.harness)}`, fields.join(" "));
}

export function eventAgents(log: string, owner: { sessionId?: string; pane?: string }): string[] {
	if (!owner.sessionId && !owner.pane) return [];
	const seen = new Set<string>();
	for (const line of log.split("\n")) {
		const [, pane, kind, agent, session] = line.split(" ");
		if (!agent || (kind !== "up" && kind !== "steer" && kind !== "down")) continue;
		const mine = kind !== "down" && (owner.sessionId ? session === `session=${encodeURIComponent(owner.sessionId)}` : pane === owner.pane);
		if (mine) seen.add(agent);
		else if (kind === "down" || !owner.sessionId) seen.delete(agent);
	}
	return [...seen];
}

export function lifecycle(log: string): { closed: Set<string>; steered: Map<string, string> } {
	const closed = new Set<string>();
	const steered = new Map<string, string>();
	for (const line of log.split("\n")) {
		const [at, , kind, agent] = line.split(" ");
		if (!agent) continue;
		if (kind === "down") closed.add(agent);
		if (kind === "up") closed.delete(agent);
		if (kind === "steer") steered.set(agent, at);
	}
	return { closed, steered };
}
