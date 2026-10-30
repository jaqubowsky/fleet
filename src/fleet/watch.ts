import { CLI } from "../harness.ts";
import { EVENTS_LOG, eventAgents, lifecycle } from "./events.ts";
import { type Io, seatOf } from "./io.ts";
import {
	RING_MS,
	SETTLE_MS,
	shouldWake,
	STALL_MS,
	stalled,
	TERMINAL,
	transition,
} from "./monitor.ts";
import { taskDir } from "./repositories.ts";
import { lastMessage, sessionsDir } from "./sessions.ts";
import { type Sandbox, sandboxes } from "./status.ts";
import { fleetTerminals, FLEET_LABEL, statusOf, type Terminal, terminalOf } from "./terminals.ts";

const REFRESH_MS = 30_000;
const RECONNECT_MS = 3000;
const STALL_TICK_MS = 60_000;
const SLEEP_MS = 5 * STALL_TICK_MS;

type Event = {
	params?: { type?: string; terminal?: string; data?: { status?: { state?: string } | null; turn?: number } };
};
type Tracked = { name: string; status: string; since: number; rang: number; terminal?: string; turn?: number; said?: string };
type Seen = { name: string; status: string; terminal?: string; turn?: number };
type Woken = { key: string; message: string; at: string };

export function fleetAgents(
	terminals: Terminal[],
	sandboxes: Pick<Sandbox, "name" | "status">[],
	wanted: string[] | undefined,
): Seen[] {
	const names = new Set(wanted);
	return sandboxes.flatMap((s) => {
		const name = s.name;
		if (wanted && !names.has(name)) return [];
		if (s.status === "stopped") return [{ name, status: "stopped" }];
		const terminal = terminalOf(s.name, terminals);
		return terminal ? [{ name, status: statusOf(terminal), terminal: terminal.address, turn: terminal.turn }] : [];
	});
}

export function sessionScope(io: Io, named: string[]): () => string[] {
	const events = `${io.home}/${EVENTS_LOG}`;
	return () => [...named, ...eventAgents(io.read(events) ?? "", io.sessionId)];
}

export function wakeLines(sandbox: string, change: string, details: string): string {
	return `[fleet] ${sandbox}: ${change}${details ? `\n\n${details}` : ""}`;
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
	seatOf(io);
	const events = `${io.home}/${EVENTS_LOG}`;
	const tracked = new Map<string, Tracked>();
	const settling = new Map<
		string,
		{
			timer: ReturnType<typeof setTimeout>;
			from: string | undefined;
		}
	>();
	const settledTurn = new Map<string, number>();
	const woken = new Map<string, Woken>();
	const dirs = new Map<string, { sandbox: Sandbox }>();
	let unfollow: (() => void) | undefined;
	let following = 0;
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
		const row = rows.find((s) => s.name === name && s.workspaces[0]);
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

	const isStopped = (sandbox: Sandbox) => sandbox.status === "stopped";

	const lastSaid = (sandbox: Sandbox): string => {
		const workspace = sandbox.workspaces[0];
		const task = taskDir(workspace, sandbox.name, io);
		return lastMessage(sessionsDir(task, sandbox.kind, workspace), io) ?? "";
	};

	const emit = (
		name: string,
		change: string,
		{ key, said, down }: { key?: string; said?: boolean; down?: boolean } = {},
	) => {
		const { closed, steered } = lifecycle(io.read(events) ?? "");
		if (closed.has(name) && !down) return;
		const rows = listed();
		const where = rows ? locate(name, rows) : dirs.get(name);
		if (!down && where && isStopped(where.sandbox)) return;
		const message = said && where ? lastSaid(where.sandbox) : "";
		if (key) {
			const last = woken.get(name);
			const unchanged =
				last !== undefined &&
				(steered.get(name) ?? "") <= last.at &&
				TERMINAL.has(key) &&
				TERMINAL.has(last.key) &&
				last.message === message;
			if (unchanged) return;
			woken.set(name, { key, message, at: io.now().toISOString() });
		}
		onWake(wakeLines(name, change, message));
	};

	const settled = (name: string, state: string) =>
		emit(name, state, { key: state, said: true });

	const leave = (
		key: string,
		entry: Tracked,
		rows: Sandbox[] | undefined,
		exited: boolean,
	) => {
		const closer = lifecycle(io.read(events) ?? "").closed.get(entry.name);
		const down =
			closer !== undefined ||
			(rows !== undefined && !rows.some((s) => s.name === entry.name));
		const own = Boolean(io.sessionId) && closer === io.sessionId;
		if (down && !own) emit(entry.name, `${entry.status} -> taken down`, { down });
		else if (!down && exited) emit(entry.name, `${entry.status} -> gone`);
		tracked.delete(key);
		report();
	};

	const settle = (key: string, from: string | undefined) => {
		const earlier = settling.get(key);
		if (earlier) clearTimeout(earlier.timer);
		const start = earlier?.from ?? from;
		const timer = setTimeout(() => {
			settling.delete(key);
			const current = tracked.get(key);
			if (!current || !TERMINAL.has(current.status)) return;
			if (!transition(start, current.status)) return;
			const turn = current.turn;
			if (turn !== undefined && settledTurn.get(key) === turn) return;
			if (turn !== undefined) settledTurn.set(key, turn);
			settled(current.name, current.status);
		}, SETTLE_MS);
		settling.set(key, { timer, from: start });
	};

	const onStatus = (key: string, status: string, turn?: number) => {
		const entry = tracked.get(key);
		if (!entry) return;
		const where = dirs.get(entry.name);
		const next = where && isStopped(where.sandbox) ? "stopped" : status;
		if (turn !== undefined) entry.turn = Math.max(entry.turn ?? 0, turn);
		const previous = entry.status;
		const change = transition(previous, next);
		if (!change) return;
		const wakeable = shouldWake(previous, next);
		const now = Date.now();
		tracked.set(key, { ...entry, status: next, since: now, rang: now });
		report();
		if (TERMINAL.has(next)) {
			if (wakeable || settling.has(key)) settle(key, previous);
			return;
		}
		const pending = settling.get(key);
		if (pending) clearTimeout(pending.timer);
		settling.delete(key);
		if (!wakeable) return;
		if (next === "blocked" || next === "error") settled(entry.name, next);
		else emit(entry.name, change, { key: change });
	};

	const onEvent = (event: Event) => {
		const { type, terminal, data } = event.params ?? {};
		if (type === "created" || type === "labels") {
			if (![...tracked.values()].some((t) => t.terminal === terminal)) refresh();
			return;
		}
		const key = [...tracked].find(([, t]) => t.terminal === terminal)?.[0];
		const entry = key ? tracked.get(key) : undefined;
		if (!key || !entry) return;
		if (type === "finished") {
			const where = dirs.get(entry.name);
			if (!(where && isStopped(where.sandbox))) leave(key, entry, listed(), true);
		} else if (type === "status") onStatus(key, data?.status?.state ?? "unknown");
		else if (type === "turn" && data?.turn !== undefined) entry.turn = Math.max(entry.turn ?? 0, data.turn);
	};

	const follow = () => {
		const mine = ++following;
		unfollow?.();
		unfollow = io.follow(
			"hc",
			["events", "--label", FLEET_LABEL, "--json"],
			(line) => {
				try {
					onEvent(JSON.parse(line) as Event);
				} catch (error) {
					io.log(`[fleet] watch: event: ${String(error)}`);
				}
			},
			() => {
				if (mine !== following || stopped) return;
				unfollow = undefined;
				setTimeout(refresh, RECONNECT_MS);
			},
		);
	};

	const refresh = () => {
		if (stopped) return;
		const wanted = scope();
		if (wanted?.length === 0 && !tracked.size) return;
		let seen: Seen[];
		let rows: Sandbox[];
		try {
			const terminals = fleetTerminals(io);
			rows = sandboxes(io);
			for (const row of rows) locate(row.name, rows);
			seen = fleetAgents(terminals, rows, wanted);
			failing = undefined;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message !== failing) io.log(`[fleet] watch: refresh: ${message}`);
			failing = message;
			setTimeout(refresh, RECONNECT_MS);
			return;
		}
		const fresh = seen.filter((a) => !tracked.has(a.name));
		for (const a of seen) {
			const entry = tracked.get(a.name);
			if (!entry) continue;
			if (entry.terminal !== a.terminal) tracked.set(a.name, { ...entry, terminal: a.terminal });
			onStatus(a.name, a.status, a.turn);
		}
		for (const [key, entry] of [...tracked]) {
			if (seen.some((a) => a.name === key)) continue;
			leave(key, entry, rows, true);
		}
		const now = Date.now();
		for (const a of fresh)
			tracked.set(a.name, { name: a.name, status: a.status, since: now, rang: now, terminal: a.terminal, turn: a.turn });
		report();
		if (fresh.length)
			io.log(
				`[fleet] watching ${[...tracked.values()].map((t) => `${t.name} ${t.status}`).join(", ")}`,
			);
		if (tracked.size && !unfollow) follow();
	};

	let ticked = Date.now();

	const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

	const slept = (now: number) => {
		const from = ticked;
		const gap = now - from - STALL_TICK_MS;
		ticked = now;
		if (gap < SLEEP_MS) return;
		const across = [...tracked].filter(([, t]) => t.since + gap <= now);
		for (const [name, t] of across)
			tracked.set(name, { ...t, since: t.since + gap, rang: t.rang + gap });
		const working = across.filter(([, t]) => t.status === "working");
		if (working.length)
			onWake(
				`[fleet] watch: this Mac slept from ${clock(from)} to ${clock(now)} while ${working.map(([, t]) => t.name).join(", ")} worked; the sleep does not count as working time, and a command running across it may have timed out`,
			);
	};

	const ring = () => {
		const now = Date.now();
		slept(now);
		const entries = [...tracked].map(([name, t]) => ({
			name,
			status: t.status,
			since: t.since,
			rang: t.rang,
		}));
		for (const name of stalled(entries, now, STALL_MS, RING_MS)) {
			const t = tracked.get(name);
			if (!t) continue;
			const where = dirs.get(t.name);
			const said = where ? lastSaid(where.sandbox) : "";
			const before = t.said ?? woken.get(t.name)?.message;
			tracked.set(name, { ...t, rang: now, said });
			if (before !== undefined && said !== before) continue;
			emit(
				t.name,
				`working ${Math.round((now - t.since) / 60_000)}m without settling`,
				{ said: true },
			);
		}
	};

	refresh();
	if (!tracked.size)
		io.log(
			`[fleet] watching nothing yet; ${CLI} up adds containers within ${REFRESH_MS / 1000}s, and ${CLI} watch <sandbox> follows one this session did not put up, start or steer`,
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
			unfollow?.();
		},
	};
}
