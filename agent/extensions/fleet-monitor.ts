import { readFileSync, unwatchFile, watchFile } from "node:fs";
import net from "node:net";
import os from "node:os";
import { basename, join } from "node:path";
import { EVENTS_LOG, eventAgents } from "../../src/fleet/events.ts";
import { agentName } from "../../src/fleet/name.ts";
import { brief } from "../../src/fleet/status.ts";

type Agent = { name?: string; pane_id?: string; agent_status?: string };
type SandboxRow = { name: string; workspaces: string[] };
type Frame = {
	event?: string;
	data?: { pane_id?: string; agent_status?: string };
};

const SOCK =
	process.env.HERDR_SOCK ?? join(os.homedir(), ".config/herdr/herdr.sock");
const RECONNECT_MS = 3000;
const LOG_POLL_MS = 2000;
const STALL_TICK_MS = 60_000;
const STALL_MS = 20 * 60_000;
const RING_MS = 15 * 60_000;
const TERMINAL = new Set(["done", "idle"]);
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

export default function (pi: any) {
	let sock: net.Socket | undefined;
	let gen = 0;
	const status = new Map<string, string>();
	const names = new Map<string, string>();
	const since = new Map<string, number>();
	const rang = new Map<string, number>();
	const selfPane = process.env.HERDR_PANE_ID ?? "";
	const log = join(os.homedir(), EVENTS_LOG);

	const track = (pane: string, next: string) => {
		status.set(pane, next);
		since.set(pane, Date.now());
		rang.set(pane, Date.now());
	};
	const forget = (pane: string) => {
		status.delete(pane);
		names.delete(pane);
		since.delete(pane);
		rang.delete(pane);
	};

	const statusOf = async (agent: string): Promise<string> => {
		const out = await pi.exec("sbx", ["ls", "--json"]).catch(() => undefined);
		const text = typeof out === "string" ? out : (out?.stdout ?? "");
		let dir: string | undefined;
		try {
			dir = taskDirOf(os.homedir(), JSON.parse(text)?.sandboxes ?? [], agent);
		} catch {
			dir = undefined;
		}
		if (!dir) return brief(undefined);
		try {
			return brief(readFileSync(`${dir}/status.md`, "utf8"));
		} catch {
			return brief(undefined);
		}
	};

	const publish = () => {
		(globalThis as any).__fleetMonitor = [...status].map(([pane, s]) => ({
			name: names.get(pane) ?? pane,
			status: s,
		}));
		pi.ui?.setStatus(
			"fleet",
			status.size ? `watching ${status.size}` : undefined,
		);
	};
	const wake = async (name: string, change: string) => {
		const text = `[fleet] ${name}: ${change}\n${await statusOf(name)}`;
		pi.sendMessage(
			{ customType: "fleet", content: text, display: true },
			{ deliverAs: "nextTurn", triggerTurn: true },
		);
		pi.ui?.notify?.(`[fleet] ${name}: ${change}`, "info");
	};

	const listAgents = async (wanted: string[]): Promise<Agent[] | undefined> => {
		const out = await pi.exec("herdr", ["agent", "list"]).catch(() => undefined);
		const text = typeof out === "string" ? out : (out?.stdout ?? "");
		try {
			return pickAgents(JSON.parse(text)?.result?.agents ?? [], wanted, selfPane);
		} catch {
			return undefined;
		}
	};

	const stop = () => {
		gen++;
		sock?.destroy();
		sock = undefined;
		status.clear();
		names.clear();
		since.clear();
		rang.clear();
		pi.ui?.setStatus("fleet", undefined);
		publish();
	};

	const reconnect = () => {
		gen++;
		sock?.destroy();
		sock = undefined;
		connect([], gen);
	};

	const adopt = async (wanted: string[]) => {
		const agents = await listAgents(wanted);
		const fresh = (agents ?? []).filter((a) => !status.has(a.pane_id!));
		if (!fresh.length) return;
		for (const a of fresh) {
			track(a.pane_id!, a.agent_status ?? "unknown");
			names.set(a.pane_id!, a.name ?? a.pane_id!);
		}
		publish();
		reconnect();
	};

	const sweep = () => {
		let text: string;
		try {
			text = readFileSync(log, "utf8");
		} catch {
			return;
		}
		const agents = eventAgents(text, selfPane);
		if (agents.length) void adopt(agents);
	};

	const ring = () => {
		const now = Date.now();
		const entries = [...status].map(([pane, st]) => ({ pane, status: st, since: since.get(pane) ?? now, rang: rang.get(pane) ?? now }));
		for (const pane of stalled(entries, now, STALL_MS, RING_MS)) {
			rang.set(pane, now);
			const minutes = Math.round((now - (since.get(pane) ?? now)) / 60_000);
			void wake(names.get(pane) ?? pane, `working ${minutes}m without settling`);
		}
	};

	const connect = (wanted: string[], myGen: number) => {
		if (myGen !== gen) return;
		sock = net.createConnection(SOCK);
		let buf = "";
		sock.on("connect", () => {
			const subs = [...status.keys()].flatMap((p) => [
				{ type: "pane.agent_status_changed", pane_id: p },
				{ type: "pane.exited", pane_id: p },
			]);
			sock!.write(
				`${JSON.stringify({ id: "fleet", method: "events.subscribe", params: { subscriptions: [...subs, { type: "tab.closed" }] } })}\n`,
			);
		});
		sock.on("data", (chunk: Buffer) => {
			if (myGen !== gen) return;
			buf += chunk.toString();
			for (;;) {
				const nl = buf.indexOf("\n");
				if (nl < 0) break;
				const line = buf.slice(0, nl);
				buf = buf.slice(nl + 1);
				let frame: Frame;
				try {
					frame = JSON.parse(line);
				} catch {
					continue;
				}
				if (frame.event === "tab_closed") {
					void refresh(wanted, myGen);
					continue;
				}
				const pane = frame.data?.pane_id;
				if (!pane || !status.has(pane)) continue;
				const who = names.get(pane) ?? pane;
				if (/pane[._]exited/.test(frame.event ?? "")) {
					void wake(who, `${status.get(pane)} -> gone`);
					forget(pane);
					publish();
					continue;
				}
				const next = frame.data?.agent_status ?? "unknown";
				const change = transition(status.get(pane), next);
				if (!change) continue;
				const wakeable = shouldWake(status.get(pane), next);
				track(pane, next);
				publish();
				if (wakeable) void wake(who, change);
			}
		});
		sock.on("error", () => {});
		sock.on("close", () => {
			if (myGen !== gen) return;
			setTimeout(() => void refresh(wanted, myGen), RECONNECT_MS);
		});
	};

	const refresh = async (wanted: string[], myGen: number) => {
		const agents = await listAgents(wanted);
		if (myGen !== gen) return;
		if (!agents) {
			if (!sock || sock.destroyed) connect(wanted, myGen);
			return;
		}
		for (const pane of [...status.keys()]) {
			if (agents.some((a) => a.pane_id === pane)) continue;
			void wake(names.get(pane) ?? pane, `${status.get(pane)} -> gone`);
			forget(pane);
		}
		publish();
		if (!status.size) return stop();
		if (!sock || sock.destroyed) connect(wanted, myGen);
	};

	const split = (args: string) =>
		args
			.trim()
			.split(/[\s,]+/)
			.filter(Boolean);

	const start = async (args: string): Promise<string> => {
		stop();
		const myGen = gen;
		const wanted = split(args);
		const agents = await listAgents(wanted);
		if (myGen !== gen) return "superseded";
		if (!agents?.length) return "no agents to watch";
		for (const a of agents) {
			track(a.pane_id!, a.agent_status ?? "unknown");
			names.set(a.pane_id!, a.name ?? a.pane_id!);
		}
		publish();
		connect(wanted, myGen);
		return `watching ${agents.map((a) => `${a.name ?? a.pane_id} ${a.agent_status ?? "?"}`).join(", ")}`;
	};

	pi.registerCommand("fleet-watch", {
		description:
			"Watch herdr agents beyond the ones this session put up or steered; a settling one wakes this session with a [fleet] line. Args: sandbox or agent names; none = all",
		handler: async (args: string, ctx: any) =>
			ctx.ui?.notify(`fleet: ${await start(args)}`, "info"),
	});
	pi.registerCommand("fleet-unwatch", {
		description: "Stop reporting agent status changes",
		handler: async (_args: string, ctx: any) => {
			stop();
			ctx.ui?.notify("fleet: stopped", "info");
		},
	});
	pi.registerTool({
		name: "fleet_watch",
		label: "Fleet watch",
		description:
			"Watch herdr agents beyond the ones this session put up or steered, which are watched by themselves. An agent settling (done, idle, blocked, gone) or working 20 minutes without settling wakes this session with a [fleet] <name>: <change> line carrying its task's status.md header; that turn is where you act on it. Pass the sandbox name from fleet ls; empty string = every agent but this one.",
		promptSnippet: "watch herdr agents; a settling one wakes this session with a [fleet] line",
		parameters: {
			type: "object",
			properties: {
				agents: {
					type: "string",
					description:
						"Space- or comma-separated sandbox names as fleet ls prints them (pi-<repo>-<label>), herdr agent names or pane ids. Empty string watches every agent",
				},
			},
			required: ["agents"],
		},
		async execute(_id: string, params: { agents?: string }) {
			return {
				content: [
					{ type: "text", text: `fleet: ${await start(params.agents ?? "")}` },
				],
			};
		},
	});
	pi.registerTool({
		name: "fleet_unwatch",
		label: "Fleet unwatch",
		description: "Stop the watch started by fleet_watch.",
		parameters: { type: "object", properties: {} },
		async execute() {
			stop();
			return { content: [{ type: "text", text: "fleet: stopped" }] };
		},
	});
	const ticker = setInterval(ring, STALL_TICK_MS);
	sweep();
	watchFile(log, { interval: LOG_POLL_MS }, sweep);
	pi.on("session_shutdown", () => {
		stop();
		clearInterval(ticker);
		unwatchFile(log, sweep);
	});
}
