import net from "node:net";
import type { Io } from "./io.ts";
import { type Agent, pickAgents, RING_MS, SETTLE_MS, type SandboxRow, shouldWake, STALL_MS, stalled, taskDirOf, TERMINAL, transition } from "./monitor.ts";
import { agentName } from "./name.ts";
import { commitsProbe, fleetSandboxes, wake } from "./status.ts";

const REFRESH_MS = 30_000;
const RECONNECT_MS = 3000;
const STALL_TICK_MS = 60_000;

type Frame = { event?: string; data?: { pane_id?: string; agent_status?: string } };
type Tracked = { name: string; status: string; since: number; rang: number };

export function fleetAgents(agents: Agent[], sandboxes: SandboxRow[], wanted: string[]): Agent[] {
	const fleet = new Set(sandboxes.map((s) => agentName(s.name)));
	return pickAgents(agents, wanted, "").filter((a) => fleet.has(a.name ?? ""));
}

export function wakeLines(name: string, change: string, details: string): string {
	return `[fleet] ${name}: ${change}\n${details}`;
}

export async function watch(wanted: string[], io: Io, socketPath = process.env.HERDR_SOCKET_PATH ?? `${io.home}/.config/herdr/herdr.sock`): Promise<void> {
	const tracked = new Map<string, Tracked>();
	const settling = new Map<string, { timer: ReturnType<typeof setTimeout>; from: string | undefined }>();
	let sock: net.Socket | undefined;
	let connection = 0;

	const sandboxes = (): SandboxRow[] => fleetSandboxes(JSON.parse(io.sbx(["ls", "--json"], { quiet: true })), io.harness.prefix);

	const details = (name: string): string => {
		const rows = sandboxes();
		const dir = taskDirOf(io.home, rows, name);
		const sandbox = rows.find((s) => agentName(s.name) === name)?.name;
		if (!dir || !sandbox) return wake(undefined, "");
		let commits = "";
		try {
			commits = io.sbx(["exec", sandbox, "sh", "-c", commitsProbe], { quiet: true });
		} catch {}
		return wake(io.read(`${dir}/status.md`), commits);
	};

	const emit = (name: string, change: string) => io.log(wakeLines(name, change, details(name)));

	const settle = (pane: string, from: string | undefined) => {
		const earlier = settling.get(pane);
		if (earlier) clearTimeout(earlier.timer);
		const start = earlier?.from ?? from;
		const timer = setTimeout(() => {
			settling.delete(pane);
			const current = tracked.get(pane);
			if (!current || !TERMINAL.has(current.status)) return;
			const change = transition(start, current.status);
			if (change) emit(current.name, change);
		}, SETTLE_MS);
		settling.set(pane, { timer, from: start });
	};

	const onFrame = (frame: Frame) => {
		const pane = frame.data?.pane_id;
		const entry = pane ? tracked.get(pane) : undefined;
		if (!pane || !entry) return;
		if (/pane[._]exited/.test(frame.event ?? "")) {
			emit(entry.name, `${entry.status} -> gone`);
			tracked.delete(pane);
			return;
		}
		const next = frame.data?.agent_status ?? "unknown";
		const previous = entry.status;
		const change = transition(previous, next);
		if (!change) return;
		const wakeable = shouldWake(previous, next);
		tracked.set(pane, { ...entry, status: next, since: Date.now(), rang: Date.now() });
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
			current.write(`${JSON.stringify({ id: "fleet", method: "events.subscribe", params: { subscriptions } })}\n`);
		});
		current.on("data", (chunk: Buffer) => {
			buf += chunk.toString();
			for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
				const line = buf.slice(0, nl);
				buf = buf.slice(nl + 1);
				try {
					onFrame(JSON.parse(line) as Frame);
				} catch {}
			}
		});
		current.on("error", (error) => io.log(`[fleet] watch: herdr socket ${socketPath}: ${error.message}`));
		current.on("close", () => {
			if (myConnection === connection) setTimeout(refresh, RECONNECT_MS);
		});
	};

	const refresh = () => {
		const agents = fleetAgents(io.herdr<{ result: { agents: Agent[] } }>(["agent", "list"]).result.agents, sandboxes(), wanted);
		const fresh = agents.filter((a) => a.pane_id && !tracked.has(a.pane_id));
		for (const agent of agents) {
			const pane = agent.pane_id;
			if (pane && tracked.has(pane))
				onFrame({ data: { pane_id: pane, agent_status: agent.agent_status } });
		}
		for (const pane of [...tracked.keys()]) {
			if (agents.some((a) => a.pane_id === pane)) continue;
			const gone = tracked.get(pane);
			if (gone) emit(gone.name, `${gone.status} -> gone`);
			tracked.delete(pane);
		}
		for (const a of fresh) tracked.set(a.pane_id!, { name: a.name ?? a.pane_id!, status: a.agent_status ?? "unknown", since: Date.now(), rang: Date.now() });
		if (fresh.length)
			io.log(`[fleet] watching ${[...tracked.values()].map((t) => `${t.name} ${t.status}`).join(", ")}`);
		if (tracked.size && (fresh.length || !sock || sock.destroyed)) connect();
	};

	const ring = () => {
		const now = Date.now();
		const entries = [...tracked].map(([pane, t]) => ({ pane, status: t.status, since: t.since, rang: t.rang }));
		for (const pane of stalled(entries, now, STALL_MS, RING_MS)) {
			const t = tracked.get(pane);
			if (!t) continue;
			tracked.set(pane, { ...t, rang: now });
			emit(t.name, `working ${Math.round((now - t.since) / 60_000)}m without settling`);
		}
	};

	refresh();
	if (!tracked.size) io.log(`[fleet] watching nothing yet; ${io.harness.cli} up adds containers within ${REFRESH_MS / 1000}s`);
	setInterval(refresh, REFRESH_MS);
	setInterval(ring, STALL_TICK_MS);
	await new Promise(() => {});
}
