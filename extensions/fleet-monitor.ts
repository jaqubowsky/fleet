import { readFileSync, unwatchFile, watchFile } from "node:fs";
import net from "node:net";
import os from "node:os";
import { join } from "node:path";
import type { Harness } from "../src/harness.ts";
import { eventAgents, eventsLog } from "../src/fleet/events.ts";
import { agentName } from "../src/fleet/name.ts";
import { type Agent, pickAgents, RING_MS, SETTLE_MS, type SandboxRow, shouldWake, STALL_MS, stalled, taskDirOf, TERMINAL, transition } from "../src/fleet/monitor.ts";
import { commitsProbe, wake as wakeText } from "../src/fleet/status.ts";

type Frame = {
	event?: string;
	data?: { pane_id?: string; agent_status?: string };
};

const SOCK =
	process.env.HERDR_SOCK ?? join(os.homedir(), ".config/herdr/herdr.sock");
const RECONNECT_MS = 3000;
const LOG_POLL_MS = 2000;
const STALL_TICK_MS = 60_000;

export default function fleetMonitor(h: Harness) {
	return (pi: any) => monitor(h, pi);
}

function monitor(h: Harness, pi: any) {
	let ui: any = pi.ui;
	let sock: net.Socket | undefined;
	let gen = 0;
	let sessionId: string | undefined;
	let sessionPath: string | undefined;
	let ticker: ReturnType<typeof setInterval> | undefined;
	const status = new Map<string, string>();
	const names = new Map<string, string>();
	const since = new Map<string, number>();
	const rang = new Map<string, number>();
	const settling = new Map<
		string,
		{ timer: ReturnType<typeof setTimeout>; from: string | undefined }
	>();
	const selfPane = process.env.HERDR_PANE_ID ?? "";
	const log = join(os.homedir(), eventsLog(h));

	const track = (pane: string, next: string) => {
		status.set(pane, next);
		since.set(pane, Date.now());
		rang.set(pane, Date.now());
	};
	const cancelSettling = (pane: string) => {
		const pending = settling.get(pane);
		if (!pending) return;
		clearTimeout(pending.timer);
		settling.delete(pane);
	};
	const forget = (pane: string) => {
		cancelSettling(pane);
		status.delete(pane);
		names.delete(pane);
		since.delete(pane);
		rang.delete(pane);
	};

	const statusOf = async (agent: string): Promise<string> => {
		const out = await pi.exec("sbx", ["ls", "--json"]).catch(() => undefined);
		const text = typeof out === "string" ? out : (out?.stdout ?? "");
		let rows: SandboxRow[] = [];
		try {
			rows = JSON.parse(text)?.sandboxes ?? [];
		} catch {
			rows = [];
		}
		const dir = taskDirOf(os.homedir(), rows, agent);
		const sandbox = rows.find((s) => agentName(s.name) === agent)?.name;
		if (!dir || !sandbox) return wakeText(undefined, "");
		const read = (file: string) => {
			try {
				return readFileSync(`${dir}/${file}`, "utf8");
			} catch {
				return undefined;
			}
		};
		const commits = await pi.exec("sbx", ["exec", sandbox, "sh", "-c", commitsProbe]).catch(() => undefined);
		return wakeText(read("status.md"), typeof commits === "string" ? commits : (commits?.stdout ?? ""));
	};

	const publish = () => {
		(globalThis as any).__fleetMonitor = [...status].map(([pane, s]) => ({
			name: names.get(pane) ?? pane,
			status: s,
		}));
		ui?.setStatus(
			"fleet",
			status.size ? `watching ${status.size}` : undefined,
		);
	};
	const wake = async (name: string, change: string, valid = () => true) => {
		const details = await statusOf(name);
		if (!valid()) return;
		const text = `[fleet] ${name}: ${change}\n${details}`;
		pi.sendMessage(
			{ customType: "fleet", content: text, display: true },
			{ deliverAs: h.deliverAs ?? "followUp", triggerTurn: true },
		);
		ui?.notify?.(`[fleet] ${name}: ${change}`, "info");
	};
	const settle = (pane: string, name: string, prev: string | undefined) => {
		const earlier = settling.get(pane);
		if (earlier) clearTimeout(earlier.timer);
		const from = earlier?.from ?? prev;
		const timer = setTimeout(() => {
			settling.delete(pane);
			const current = status.get(pane);
			if (!current || !TERMINAL.has(current)) return;
			const change = transition(from, current);
			if (change)
				void wake(name, change, () => TERMINAL.has(status.get(pane) ?? ""));
		}, SETTLE_MS);
		settling.set(pane, { timer, from });
	};

	const updateStatus = (pane: string, next: string) => {
		const previous = status.get(pane);
		const change = transition(previous, next);
		if (!change) return;
		const who = names.get(pane) ?? pane;
		const wakeable = shouldWake(previous, next);
		track(pane, next);
		publish();
		if (TERMINAL.has(next)) {
			if (wakeable || settling.has(pane)) settle(pane, who, previous);
			return;
		}
		cancelSettling(pane);
		if (wakeable) void wake(who, change);
	};

	const listAgents = async (wanted: string[]): Promise<Agent[] | undefined> => {
		const out = await pi.exec("herdr", ["agent", "list"]).catch(() => undefined);
		const text = typeof out === "string" ? out : (out?.stdout ?? "");
		try {
			const agents = JSON.parse(text)?.result?.agents ?? [];
			const ownPane = selfPane || agents.find((a: Agent) =>
				(sessionId && a.agent_session_id === sessionId) ||
				(sessionPath && a.agent_session_path === sessionPath)
			)?.pane_id || "";
			return pickAgents(agents, wanted, ownPane);
		} catch {
			return undefined;
		}
	};

	const stop = () => {
		gen++;
		sock?.destroy();
		sock = undefined;
		for (const pane of settling.keys()) cancelSettling(pane);
		status.clear();
		names.clear();
		since.clear();
		rang.clear();
		ui?.setStatus("fleet", undefined);
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
		const agents = eventAgents(text, h.owner === "session" ? { sessionId } : { pane: selfPane });
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
				updateStatus(pane, frame.data?.agent_status ?? "unknown");
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
		for (const agent of agents) {
			const pane = agent.pane_id;
			if (pane && status.has(pane))
				updateStatus(pane, agent.agent_status ?? "unknown");
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
			"Watch herdr agents beyond the ones this session put up or steered; one settling or working on without settling wakes this session with a [fleet] line. Args: sandbox or agent names; none = all",
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
			`Watch herdr agents beyond the ones this session put up or steered, which are watched by themselves. An agent settling (done, idle, blocked, gone) or working 20 minutes without settling wakes this session with a [fleet] <name>: <change> line carrying a bounded projection of status.md (status, attention, summary, next step) and recent commits; that turn is where you act on it. Pass the sandbox name from ${h.cli} ls; empty string = every agent but this one.`,
		promptSnippet: "watch herdr agents; a settling one wakes this session with a [fleet] line",
		parameters: {
			type: "object",
			properties: {
				agents: {
					type: "string",
					description:
						`Space- or comma-separated sandbox names as ${h.cli} ls prints them (${h.prefix}<repo>-<label>), herdr agent names or pane ids. Empty string watches every agent`,
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
	pi.on("session_start", (_event: unknown, ctx: any) => {
		sessionId = ctx.sessionManager?.getSessionId?.();
		sessionPath = ctx.sessionManager?.getSessionFile?.();
		if (sessionId && h.sessionIdEnv) process.env[h.sessionIdEnv] = sessionId;
		ui = ctx.ui ?? ui;
		ticker = setInterval(ring, STALL_TICK_MS);
		sweep();
		watchFile(log, { interval: LOG_POLL_MS }, sweep);
	});
	pi.on("session_shutdown", () => {
		stop();
		clearInterval(ticker);
		unwatchFile(log, sweep);
	});
}
