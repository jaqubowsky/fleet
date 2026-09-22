import type { Io } from "./io.ts";

export const EVENTS_LOG = ".pi/agent/fleet-events.log";

export function logEvent(io: Io, kind: "up" | "steer", agent: string, text?: string): void {
	const fields = [io.now().toISOString(), io.pane, kind, agent];
	if (text !== undefined) fields.push(JSON.stringify(text));
	io.append(`${io.home}/${EVENTS_LOG}`, fields.join(" "));
}

export function eventAgents(log: string, pane: string): string[] {
	const seen = new Set<string>();
	for (const line of log.split("\n")) {
		const [, from, kind, agent] = line.split(" ");
		if (!agent || (kind !== "up" && kind !== "steer")) continue;
		if (pane && from !== pane) continue;
		seen.add(agent);
	}
	return [...seen];
}
