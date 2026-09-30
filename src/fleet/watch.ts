import net from "node:net";
import { STOPPED } from "../../extensions/handoff-on-error.ts";
import {
	ACTIVITY,
	fieldsOf,
	logLines,
} from "../../extensions/status-history.ts";
import { activityOf } from "./activity.ts";
import { activityNow, blockedWork, steer } from "./commands.ts";
import { CLI, CONTINUE } from "../harness.ts";
import { limitStop, resetAt, resumeDue, RETRIES } from "./limit.ts";
import { EVENTS_LOG, eventAgents, lifecycle, steersSince } from "./events.ts";
import { type Io, seatOf } from "./io.ts";
import {
	FAILED_IN_A_ROW,
	idleStalled,
	RING_MS,
	SETTLE_MS,
	shouldWake,
	STALL_MS,
	stalled,
	taskDirOf,
	TERMINAL,
	transition,
} from "./monitor.ts";
import { agentName } from "./name.ts";
import { groupManifest, repositoryCheckout } from "./repositories.ts";
import {
	type Agent,
	branchFacts,
	calls,
	type Sandbox,
	sandboxes,
	wake,
} from "./status.ts";

const REFRESH_MS = 30_000;
const RECONNECT_MS = 3000;
const STALL_TICK_MS = 60_000;
const WAITS_ON_HOST = new Set(["blocked", "paused"]);

type Frame = {
	event?: string;
	data?: { pane_id?: string; agent_status?: string };
};
type Tracked = { name: string; status: string; since: number; rang: number };
type Woken = { status: string | undefined; facts: string; at: string };

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
	return `[fleet] ${agent}: ${what}\n\n${details}`;
}

export function wakeName(text: string): string | undefined {
	return text.match(/^\[fleet\] ([^:\s]+):/)?.[1];
}

export function watch(
	scope: () => string[] | undefined,
	io: Io,
	onWake: (text: string) => void = io.log,
): { refresh: () => void; stop: () => void } {
	const socketPath =
		process.env.HERDR_SOCKET_PATH ?? `${io.home}/.config/herdr/herdr.sock`;
	seatOf(io);
	const events = `${io.home}/${EVENTS_LOG}`;
	const tracked = new Map<string, Tracked>();
	const settling = new Map<
		string,
		{ timer: ReturnType<typeof setTimeout>; from: string | undefined }
	>();
	const logShown = new Map<string, string[]>();
	const woken = new Map<string, Woken>();
	const deaths = new Map<string, string>();
	const streaks = new Map<string, string>();
	const dirs = new Map<
		string,
		{ dir: string; sandbox: Sandbox; repo: string }
	>();
	let sock: net.Socket | undefined;
	let connection = 0;
	let stopped = false;
	let failing: string | undefined;
	let failingLocate: string | undefined;

	const locate = (name: string, rows: Sandbox[]) => {
		const dir = taskDirOf(io.home, rows, name, io);
		const row = rows.find((s) => agentName(s.name) === name);
		if (dir && row)
			dirs.set(name, { dir, sandbox: row, repo: row.workspaces[0] });
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

	const statusOf = (name: string): string | undefined => {
		const where = dirs.get(name);
		return where ? io.read(`${where.dir}/status.md`) : undefined;
	};

	const factsOf = (name: string): { text: string; running: boolean } => {
		const where = dirs.get(name);
		if (!where)
			return { text: "commits: not counted\n\npr: not read", running: false };
		const manifest = groupManifest(where.sandbox.name, io);
		if (manifest) {
			const lines: string[] = [];
			let running = false;
			for (const repo of manifest.repositories) {
				try {
					const current = repositoryCheckout(io, where.sandbox.name, repo.workspace);
					const facts = branchFacts(io, where.sandbox.name, repo.repo, repo);
					running ||= facts.running;
					lines.push(
						`${repo.name} ${current.branch} ${current.dirty} dirty ${current.head}\ncommits: ${facts.commits}\npr: ${facts.pr}`,
					);
				} catch (error) {
					lines.push(`${repo.name}: failed: ${String(error).split("\n").at(-1)}`);
				}
			}
			return { text: lines.join("\n\n"), running };
		}
		const facts = branchFacts(io, where.sandbox.name, where.repo);
		return {
			text: `commits: ${facts.commits}\n\npr: ${facts.pr}`,
			running: facts.running,
		};
	};

	const details = (
		name: string,
		status: string | undefined,
		facts: string,
	): string => {
		const where = dirs.get(name);
		let activity = "";
		try {
			activity = where ? activityNow(where.sandbox, where.dir, io) : "";
		} catch (error) {
			io.log(`[fleet] watch: activity: ${String(error)}`);
		}
		const text = wake(status, facts, logShown.get(name));
		logShown.set(name, logLines(status));
		const blocked = where ? blockedWork(where.dir, io) : 0;
		return `${text}${blocked ? `\n\nstill working while blocked: ${calls(blocked)} since status.md turned blocked` : ""}${activity ? `\n\nactivity: ${activity}` : ""}`;
	};

	const emit = (
		name: string,
		change: string,
		when: { settled?: boolean; unlessCi?: boolean; down?: boolean } = {},
	) => {
		const { closed, steered } = lifecycle(io.read(events) ?? "");
		if (closed.has(name) && !when.down) return;
		const rows = listed();
		if (rows) locate(name, rows);
		const status = statusOf(name);
		const facts = factsOf(name);
		if (
			when.unlessCi &&
			facts.running &&
			!WAITS_ON_HOST.has(fieldsOf(status).status ?? "")
		)
			return;
		const last = woken.get(name);
		if (
			when.settled &&
			last &&
			last.status === status &&
			last.facts === facts.text &&
			(steered.get(name) ?? "") <= last.at
		)
			return;
		woken.set(name, { status, facts: facts.text, at: io.now().toISOString() });
		onWake(
			wakeLines(
				name,
				dirs.get(name)?.sandbox.name ?? name,
				change,
				details(name, status, facts.text),
			),
		);
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
	};

	const settle = (pane: string, from: string | undefined) => {
		const earlier = settling.get(pane);
		if (earlier) clearTimeout(earlier.timer);
		const start = earlier?.from ?? from;
		const timer = setTimeout(() => {
			settling.delete(pane);
			const current = tracked.get(pane);
			if (!current || !TERMINAL.has(current.status)) return;
			const change = transition(start, current.status);
			if (change) emit(current.name, change, { settled: true, unlessCi: true });
		}, SETTLE_MS);
		settling.set(pane, { timer, from: start });
	};

	const onFrame = (frame: Frame) => {
		const pane = frame.data?.pane_id;
		const entry = pane ? tracked.get(pane) : undefined;
		if (!pane || !entry) return;
		if (/pane[._]exited/.test(frame.event ?? "")) {
			leave(pane, entry, listed(), true);
			return;
		}
		const next = frame.data?.agent_status ?? "unknown";
		const previous = entry.status;
		const change = transition(previous, next);
		if (!change) return;
		const wakeable = shouldWake(previous, next);
		const now = Date.now();
		tracked.set(pane, { ...entry, status: next, since: now, rang: now });
		if (TERMINAL.has(next)) {
			if (wakeable || settling.has(pane)) settle(pane, previous);
			return;
		}
		const pending = settling.get(pane);
		if (pending) clearTimeout(pending.timer);
		settling.delete(pane);
		if (wakeable) emit(entry.name, change);
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

	const noticeDeaths = (rows: Sandbox[]) => {
		for (const t of tracked.values()) {
			if (t.status !== "working" || !locate(t.name, rows)) continue;
			const attention = fieldsOf(statusOf(t.name)).attention ?? "";
			if (!attention.startsWith(STOPPED)) {
				deaths.delete(t.name);
				continue;
			}
			if (deaths.get(t.name) === attention) continue;
			deaths.set(t.name, attention);
			emit(t.name, `${t.status} -> stopped on an error`);
		}
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
				.agents;
			rows = sandboxes(io);
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
				onFrame({ data: { pane_id: pane, agent_status: agent.agent_status } });
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
		noticeDeaths(rows);
		if (fresh.length)
			io.log(
				`[fleet] watching ${[...tracked.values()].map((t) => `${t.name} ${t.status}`).join(", ")}`,
			);
		if (tracked.size && (fresh.length || !sock || sock.destroyed)) connect();
	};

	const noticeFailures = () => {
		for (const t of tracked.values()) {
			const where = dirs.get(t.name);
			if (t.status !== "working" || !where) continue;
			const activity = activityOf(io.read(`${where.dir}/${ACTIVITY}`));
			if (
				!activity?.streakFrom ||
				activity.streak < FAILED_IN_A_ROW ||
				streaks.get(t.name) === activity.streakFrom
			)
				continue;
			streaks.set(t.name, activity.streakFrom);
			emit(t.name, `working, ${activity.streak} tool calls failed in a row`);
		}
	};

	const noticeIdle = (now: number) => {
		const quiet = [...tracked].filter(
			([, t]) =>
				t.rang <= t.since && idleStalled(t.status, undefined, now - t.since),
		);
		if (!quiet.length) return;
		const rows = listed();
		if (!rows) return;
		for (const [pane, t] of quiet) {
			if (!locate(t.name, rows)) continue;
			const status = fieldsOf(statusOf(t.name)).status;
			tracked.set(pane, { ...t, rang: now });
			if (!idleStalled(t.status, status, now - t.since)) continue;
			emit(
				t.name,
				`${t.status} ${Math.round((now - t.since) / 60_000)}m at ${status ?? "no status"}, stalled`,
				{ unlessCi: true },
			);
		}
	};

	const resets = new Map<string, Date | undefined>();

	const noticeLimits = () => {
		const idle = [...tracked.values()].filter(
			(t) => t.status === "idle" || t.status === "done",
		);
		const rows = idle.some((t) => !dirs.has(t.name)) ? listed() : undefined;
		for (const t of idle) {
			const where = dirs.get(t.name) ?? (rows && locate(t.name, rows));
			if (!where || !limitStop(fieldsOf(statusOf(t.name)).attention)) continue;
			const stoppedAt = io.stat(`${where.dir}/status.md`)?.mtime;
			if (!stoppedAt) continue;
			const stop = `${t.name}@${stoppedAt.toISOString()}`;
			if (!resets.has(stop)) {
				let pane = "";
				try {
					pane = io.herdrText([
						"agent",
						"read",
						t.name,
						"--source",
						"recent-unwrapped",
						"--lines",
						"40",
					]);
				} catch (error) {
					io.log(`[fleet] watch: limit: ${String(error)}`);
				}
				resets.set(stop, resetAt(pane, stoppedAt));
			}
			const resumes = steersSince(
				io.read(events) ?? "",
				t.name,
				CONTINUE,
				stoppedAt,
			);
			const last = resumes.at(-1);
			const worked = activityOf(io.read(`${where.dir}/${ACTIVITY}`))?.last;
			if (last && worked && new Date(worked) > last) continue;
			const due = resumeDue(stoppedAt, resets.get(stop), resumes);
			if (io.now() < due) continue;
			if (resumes.length >= RETRIES) {
				if (io.now().getTime() < due.getTime() + STALL_TICK_MS)
					emit(
						t.name,
						`stopped on the account limit, ${RETRIES} resumes did not take`,
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
		noticeFailures();
		const now = Date.now();
		noticeIdle(now);
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
