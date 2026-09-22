import { readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import { basename, join } from "node:path";
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
	const selfPane = process.env.HERDR_PANE_ID ?? "";

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
		pi.ui?.setStatus("fleet", undefined);
		publish();
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
					status.delete(pane);
					names.delete(pane);
					publish();
					continue;
				}
				const next = frame.data?.agent_status ?? "unknown";
				const change = transition(status.get(pane), next);
				if (!change) continue;
				const wakeable = shouldWake(status.get(pane), next);
				status.set(pane, next);
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
			status.delete(pane);
			names.delete(pane);
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
			status.set(a.pane_id!, a.agent_status ?? "unknown");
			names.set(a.pane_id!, a.name ?? a.pane_id!);
		}
		publish();
		connect(wanted, myGen);
		return `watching ${agents.map((a) => `${a.name ?? a.pane_id} ${a.agent_status ?? "?"}`).join(", ")}`;
	};

	pi.registerCommand("fleet-watch", {
		description:
			"Watch other herdr agents; a settling one wakes this session with a [fleet] line. Args: sandbox or agent names; none = all",
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
			"Watch other herdr agents. An agent settling (done, idle, blocked, gone) wakes this session with a [fleet] <name>: <prev> -> <status> line carrying its task's status.md header; that turn is where you act on it. Watches only the agents that exist now, so call again after each fleet up. Pass the sandbox name from fleet up or fleet ls; empty string = every agent but this one.",
		promptSnippet: "watch herdr agents; a settling one wakes this session with a [fleet] line",
		parameters: {
			type: "object",
			properties: {
				agents: {
					type: "string",
					description:
						"Space- or comma-separated sandbox names as fleet ls prints them (pi-<repo>-<label>), herdr agent names or pane ids. Empty string watches every agent, so name the one container when the user asked for one",
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
	pi.on("session_shutdown", () => stop());
}
