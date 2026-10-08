import { FLEET } from "./home.ts";
import type { Io } from "./io.ts";

export const EVENTS_LOG = `${FLEET.tasks}/fleet-events.log`;

export function logEvent(io: Io, kind: "up" | "steer" | "down" | "stop" | "start" | "created", agent: string, text?: string): void {
	const fields = [io.now().toISOString(), io.pane, kind, agent, `session=${encodeURIComponent(io.sessionId ?? "")}`];
	if (kind === "created") fields.push("runtime=1");
	if (text !== undefined) fields.push(JSON.stringify(text));
	io.append(`${io.home}/${EVENTS_LOG}`, fields.join(" "));
}

export type Runtime = {
	coverage: "complete" | "partial" | "unavailable";
	started_at?: string;
	finished_at: string;
	elapsed_ms?: number;
	running_ms?: number;
	stopped_ms?: number;
	stop_count?: number;
	restart_count?: number;
	running_periods?: { started_at: string; finished_at: string }[];
};

export function runtimeOf(log: string | undefined, agent: string, finished: Date): Runtime {
	const events = (log ?? "").split("\n").map((line) => {
		const [at, , kind, name, ...fields] = line.split(" ");
		return { at, kind, name, fields, time: Date.parse(at) };
	}).filter((event) => event.name === agent && event.time <= finished.getTime());
	const creation = events.map((event) => event.kind).lastIndexOf("created");
	const begin = creation >= 0 ? creation : events.map((event) => event.kind).lastIndexOf("up");
	if (begin < 0) return { coverage: "unavailable", finished_at: finished.toISOString() };
	const first = events[begin];
	let complete = first.kind === "created" && first.fields.includes("runtime=1");
	let stoppedAt: number | undefined;
	let stoppedMs = 0;
	let stops = 0;
	let restarts = 0;
	let last = first.time;
	let runningSince = first.time;
	const periods: { started_at: string; finished_at: string }[] = [];
	for (const event of events.slice(begin + 1)) {
		if (event.time < last || event.kind === "down") complete = false;
		last = event.time;
		if (event.kind === "stop" && stoppedAt === undefined) {
			periods.push({ started_at: new Date(runningSince).toISOString(), finished_at: new Date(event.time).toISOString() });
			stoppedAt = event.time;
			stops++;
		}
		if (event.kind === "start") {
			if (stoppedAt === undefined) complete = false;
			else {
				stoppedMs += event.time - stoppedAt;
				stoppedAt = undefined;
				runningSince = event.time;
				restarts++;
			}
		}
	}
	if (stoppedAt !== undefined) stoppedMs += finished.getTime() - stoppedAt;
	else periods.push({ started_at: new Date(runningSince).toISOString(), finished_at: finished.toISOString() });
	const elapsed = finished.getTime() - first.time;
	const runtime: Runtime = {
		coverage: complete ? "complete" : "partial",
		started_at: first.at,
		finished_at: finished.toISOString(),
		elapsed_ms: elapsed,
	};
	if (complete) Object.assign(runtime, { running_ms: elapsed - stoppedMs, stopped_ms: stoppedMs, stop_count: stops, restart_count: restarts, running_periods: periods });
	return runtime;
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

export function steersSince(log: string, agent: string, text: string, after: Date): Date[] {
	const quoted = JSON.stringify(text);
	return log.split("\n").flatMap((line) => {
		const [at, , kind, name] = line.split(" ");
		const when = new Date(at);
		return kind === "steer" && name === agent && line.endsWith(` ${quoted}`) && when > after ? [when] : [];
	});
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
