import net from "node:net";
import { steer, stoppedPane } from "./commands.ts";
import { CLI, CONTINUE } from "../harness.ts";
import { limitStop, resetAt, resumeDue, RETRIES } from "./limit.ts";
import { EVENTS_LOG, eventAgents, lifecycle, steersSince } from "./events.ts";
import { type Io, seatOf } from "./io.ts";
import {
	closingLabel,
	RING_MS,
	SETTLE_MS,
	shouldWake,
	STALL_MS,
	stalled,
	TAIL_LINES,
	TERMINAL,
	transition,
} from "./monitor.ts";
import { agentName } from "./name.ts";
import { type Agent, type Sandbox, sandboxes } from "./status.ts";

const REFRESH_MS = 30_000;
const RECONNECT_MS = 3000;
const STALL_TICK_MS = 60_000;
const SAME_WAKES = 2;

type Frame = {
	event?: string;
	data?: { pane_id?: string; agent_status?: string; state_change_seq?: number };
};
type Tracked = { name: string; status: string; since: number; rang: number };
type Woken = { key: string; count: number; at: string };
type LimitStop = { at: Date; reset: Date | undefined };

export function fleetAgents(
	agents: Agent[],
	sandboxes: Pick<Sandbox, "name" | "workspaces">[],
	wanted: string[] | undefined,
): Agent[] {
	const fleet = new Set(sandboxes.map((s) => agentName(s.name)));
	const names = new Set(wanted?.flatMap((w) => [w, agentName(w)]));
	return agents.filter(
		(a) =>
			a.pane_id &&
			fleet.has(a.name ?? "") &&
			(!wanted || names.has(a.name ?? "") || names.has(a.pane_id)),
	);
}

export function paneScope(io: Io, named: string[]): () => string[] {
	const events = `${io.home}/${EVENTS_LOG}`;
	return () => [
		...named,
		...eventAgents(io.read(events) ?? "", {
			pane: io.pane === "-" ? undefined : io.pane,
		}),
	];
}

export function wakeLines(
	agent: string,
	sandbox: string,
	change: string,
	details: string,
): string {
	const what = sandbox === agent ? change : `${sandbox} ${change}`;
	return `[fleet] ${agent}: ${what}${details ? `\n\n${details}` : ""}`;
}

export function wakeName(text: string): string | undefined {
	return text.match(/^\[fleet\] ([^:\s]+):/)?.[1];
}

export function jsonLines(io: Io): {
	io: Io;
	onWake: (text: string) => void;
	onTracked: (line: string) => void;
} {
	return {
		io: { ...io, log: (line) => io.log(JSON.stringify({ log: line })) },
		onWake: (text) => io.log(JSON.stringify({ wake: text })),
		onTracked: (line) => io.log(JSON.stringify({ watching: line })),
	};
}

export function watch(
	scope: () => string[] | undefined,
	io: Io,
	onWake: (text: string) => void = io.log,
	onTracked: (line: string) => void = () => {},
): { refresh: () => void; stop: () => void } {
	const socketPath =
		process.env.HERDR_SOCKET_PATH ?? `${io.home}/.config/herdr/herdr.sock`;
	seatOf(io);
	const events = `${io.home}/${EVENTS_LOG}`;
	const tracked = new Map<string, Tracked>();
	const settling = new Map<
		string,
		{
			timer: ReturnType<typeof setTimeout>;
			from: string | undefined;
			seq: number | undefined;
		}
	>();
	const settledSeq = new Map<string, number>();
	const woken = new Map<string, Woken>();
	const limits = new Map<string, LimitStop>();
	const dirs = new Map<string, { sandbox: Sandbox }>();
	let sock: net.Socket | undefined;
	let connection = 0;
	let stopped = false;
	let failing: string | undefined;
	let failingLocate: string | undefined;
	let reported: string | undefined;

	const report = () => {
		const line = [...tracked.values()].map((t) => `${t.name} ${t.status}`).join(" · ");
		if (line !== reported) onTracked(line);
		reported = line;
	};

	const locate = (name: string, rows: Sandbox[]) => {
		const row = rows.find((s) => agentName(s.name) === name && s.workspaces[0]);
		if (row) dirs.set(name, { sandbox: row });
		return dirs.get(name);
	};

	const listed = (): Sandbox[] | undefined => {
		try {
			const rows = sandboxes(io);
			failingLocate = undefined;
			return rows;
		} catch (error) {
			if (String(error) !== failingLocate)
				io.log(`[fleet] watch: locate: ${String(error)}`);
			failingLocate = String(error);
		}
	};

	const isStopped = (sandbox: Sandbox) =>
		sandbox.status === "stopped" || Boolean(stoppedPane(sandbox, io));

	const tailOf = (name: string): string => {
		try {
			return io
				.herdrText([
					"agent",
					"read",
					name,
					"--source",
					"recent-unwrapped",
					"--lines",
					String(TAIL_LINES),
				])
				.trimEnd();
		} catch (error) {
			return `pane not read: ${String(error).split("\n")[0]}`;
		}
	};

	const emit = (
		name: string,
		change: string,
		{ key, tail, down }: { key?: string; tail?: string; down?: boolean } = {},
	) => {
		const { closed, steered } = lifecycle(io.read(events) ?? "");
		if (closed.has(name) && !down) return;
		const rows = listed();
		const where = rows ? locate(name, rows) : dirs.get(name);
		if (!down && where && isStopped(where.sandbox)) return;
		if (key) {
			const last = woken.get(name);
			const repeat =
				last?.key === key && (steered.get(name) ?? "") <= last.at;
			if (repeat && last.count >= SAME_WAKES) return;
			woken.set(name, {
				key,
				count: repeat ? last.count + 1 : 1,
				at: io.now().toISOString(),
			});
		}
		onWake(
			wakeLines(name, where?.sandbox.name ?? name, change, tail ?? ""),
		);
	};

	const settled = (name: string, state: string) => {
		const tail = tailOf(name);
		const label = closingLabel(tail);
		if (label !== "no closing message") limits.delete(name);
		else if (limitStop(tail)) {
			if (!limits.has(name)) {
				const at = io.now();
				limits.set(name, { at, reset: resetAt(tail, at) });
			}
			return;
		}
		const change = state === "blocked" ? `blocked, ${label}` : label;
		emit(name, change, { key: `${state} ${label}`, tail });
	};

	const leave = (
		pane: string,
		entry: Tracked,
		rows: Sandbox[] | undefined,
		exited: boolean,
	) => {
		const down =
			lifecycle(io.read(events) ?? "").closed.has(entry.name) ||
			(rows !== undefined && !rows.some((s) => agentName(s.name) === entry.name));
		if (down) emit(entry.name, `${entry.status} -> taken down`, { down });
		else if (exited) emit(entry.name, `${entry.status} -> gone`);
		tracked.delete(pane);
		report();
	};

	const settle = (pane: string, from: string | undefined, seq: number | undefined) => {
		const earlier = settling.get(pane);
		if (earlier) clearTimeout(earlier.timer);
		const start = earlier?.from ?? from;
		const timer = setTimeout(() => {
			settling.delete(pane);
			const current = tracked.get(pane);
			if (!current || !TERMINAL.has(current.status)) return;
			if (!transition(start, current.status)) return;
			if (seq !== undefined && settledSeq.get(pane) === seq) return;
			if (seq !== undefined) settledSeq.set(pane, seq);
			settled(current.name, current.status);
		}, SETTLE_MS);
		settling.set(pane, { timer, from: start, seq });
	};

	const onFrame = (frame: Frame) => {
		const pane = frame.data?.pane_id;
		const entry = pane ? tracked.get(pane) : undefined;
		if (!pane || !entry) return;
		const where = dirs.get(entry.name);
		const stopped = where && isStopped(where.sandbox);
		if (!stopped && /pane[._]exited/.test(frame.event ?? "")) {
			leave(pane, entry, listed(), true);
			return;
		}
		const next = stopped ? "stopped" : frame.data?.agent_status ?? "unknown";
		const seq = frame.data?.state_change_seq;
		const previous = entry.status;
		const change = transition(previous, next);
		if (!change) return;
		const wakeable = shouldWake(previous, next);
		const now = Date.now();
		tracked.set(pane, { ...entry, status: next, since: now, rang: now });
		report();
		if (TERMINAL.has(next)) {
			if (wakeable || settling.has(pane)) settle(pane, previous, seq);
			return;
		}
		const pending = settling.get(pane);
		if (pending) clearTimeout(pending.timer);
		settling.delete(pane);
		if (!wakeable) return;
		if (next === "blocked") settled(entry.name, next);
		else emit(entry.name, change, { key: change });
	};

	const connect = () => {
		const myConnection = ++connection;
		sock?.destroy();
		const current = net.createConnection(socketPath);
		sock = current;
		let buf = "";
		current.on("connect", () => {
			const subscriptions = [...tracked.keys()].flatMap((pane_id) => [
				{ type: "pane.agent_status_changed", pane_id },
				{ type: "pane.exited", pane_id },
			]);
			current.write(
				`${JSON.stringify({ id: "fleet", method: "events.subscribe", params: { subscriptions } })}\n`,
			);
		});
		current.on("data", (chunk: Buffer) => {
			buf += chunk.toString();
			for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
				const line = buf.slice(0, nl);
				buf = buf.slice(nl + 1);
				try {
					onFrame(JSON.parse(line) as Frame);
				} catch (error) {
					io.log(`[fleet] watch: frame: ${String(error)}`);
				}
			}
		});
		current.on("error", (error) =>
			io.log(`[fleet] watch: herdr socket ${socketPath}: ${error.message}`),
		);
		current.on("close", () => {
			if (myConnection === connection) setTimeout(refresh, RECONNECT_MS);
		});
	};

	const refresh = () => {
		if (stopped) return;
		const wanted = scope();
		if (wanted?.length === 0 && !tracked.size) return;
		let listed: Agent[];
		let agents: Agent[];
		let rows: Sandbox[];
		try {
			listed = io.herdr<{ result: { agents: Agent[] } }>(["agent", "list"]).result
				.agents.map((agent) => ({ ...agent }));
			rows = sandboxes(io);
			for (const row of rows) {
				locate(agentName(row.name), rows);
				const saved = stoppedPane(row, io);
				if (row.status !== "stopped" && !saved) continue;
				const name = agentName(row.name);
				const live = listed.find((a) => a.name === name);
				if (live) live.agent_status = "stopped";
				else if (saved) listed.push({ name, pane_id: saved, agent_status: "stopped" });
			}
			agents = fleetAgents(listed, rows, wanted);
			failing = undefined;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message !== failing) io.log(`[fleet] watch: refresh: ${message}`);
			failing = message;
			setTimeout(refresh, RECONNECT_MS);
			return;
		}
		const fresh = agents.filter((a) => a.pane_id && !tracked.has(a.pane_id));
		for (const agent of agents) {
			const pane = agent.pane_id;
			if (pane && tracked.has(pane))
				onFrame({
					data: {
						pane_id: pane,
						agent_status: agent.agent_status,
						state_change_seq: agent.state_change_seq,
					},
				});
		}
		for (const pane of [...tracked.keys()]) {
			if (agents.some((a) => a.pane_id === pane)) continue;
			const entry = tracked.get(pane);
			if (entry) leave(pane, entry, rows, !listed.some((a) => a.pane_id === pane));
		}
		const now = Date.now();
		for (const a of fresh)
			tracked.set(a.pane_id, {
				name: a.name ?? a.pane_id,
				status: a.agent_status ?? "unknown",
				since: now,
				rang: now,
			});
		report();
		if (fresh.length)
			io.log(
				`[fleet] watching ${[...tracked.values()].map((t) => `${t.name} ${t.status}`).join(", ")}`,
			);
		if (tracked.size && (fresh.length || !sock || sock.destroyed)) connect();
	};

	const noticeLimits = () => {
		const waiting = [...tracked.values()].filter(
			(t) => TERMINAL.has(t.status) && limits.has(t.name),
		);
		const rows = waiting.length ? listed() : undefined;
		for (const t of waiting) {
			const stop = limits.get(t.name);
			const where = rows && locate(t.name, rows);
			if (!stop || !where || isStopped(where.sandbox)) continue;
			const resumes = steersSince(io.read(events) ?? "", t.name, CONTINUE, stop.at);
			const due = resumeDue(stop.at, stop.reset, resumes);
			if (io.now() < due) continue;
			if (resumes.length >= RETRIES) {
				if (io.now().getTime() < due.getTime() + STALL_TICK_MS)
					emit(
						t.name,
						`stopped on the account limit, ${RETRIES} resumes did not take`,
						{ tail: tailOf(t.name) },
					);
				continue;
			}
			try {
				steer(where.sandbox, CONTINUE, io);
				io.log(`[fleet] ${t.name}: resumed after the account limit`);
			} catch (error) {
				io.log(`[fleet] watch: resume ${t.name}: ${String(error)}`);
			}
		}
	};

	const ring = () => {
		noticeLimits();
		const now = Date.now();
		const entries = [...tracked].map(([pane, t]) => ({
			pane,
			status: t.status,
			since: t.since,
			rang: t.rang,
		}));
		for (const pane of stalled(entries, now, STALL_MS, RING_MS)) {
			const t = tracked.get(pane);
			if (!t) continue;
			tracked.set(pane, { ...t, rang: now });
			emit(
				t.name,
				`working ${Math.round((now - t.since) / 60_000)}m without settling`,
				{ tail: tailOf(t.name) },
			);
		}
	};

	refresh();
	if (!tracked.size)
		io.log(
			`[fleet] watching nothing yet; ${CLI} up adds containers within ${REFRESH_MS / 1000}s, and ${CLI} watch <sandbox> follows one this pane did not start`,
		);
	const timers = [
		setInterval(refresh, REFRESH_MS),
		setInterval(ring, STALL_TICK_MS),
	];
	return {
		refresh,
		stop: () => {
			stopped = true;
			for (const timer of timers) clearInterval(timer);
			for (const { timer } of settling.values()) clearTimeout(timer);
			sock?.destroy();
		},
	};
}
