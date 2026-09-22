import type { Harness } from "../harness.ts";
import type { Io } from "./io.ts";

export function eventsLog(h: Harness): string {
	return `${h.home}/agent/fleet-events.log`;
}

export function logEvent(io: Io, kind: "up" | "steer", agent: string, text?: string): void {
	if (io.harness.owner === "none") return;
	const fields = [io.now().toISOString(), io.pane, kind, agent, `session=${encodeURIComponent(io.sessionId ?? "")}`];
	if (text !== undefined) fields.push(JSON.stringify(text));
	io.append(`${io.home}/${eventsLog(io.harness)}`, fields.join(" "));
}

export function eventAgents(log: string, owner: { sessionId?: string; pane?: string }): string[] {
	if (!owner.sessionId && !owner.pane) return [];
	const seen = new Set<string>();
	for (const line of log.split("\n")) {
		const [, pane, kind, agent, session] = line.split(" ");
		if (!agent || (kind !== "up" && kind !== "steer")) continue;
		if (owner.sessionId ? session !== `session=${encodeURIComponent(owner.sessionId)}` : pane !== owner.pane) continue;
		seen.add(agent);
	}
	return [...seen];
}
