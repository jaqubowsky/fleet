import net from "node:net";
import os from "node:os";
import { join } from "node:path";

type Agent = { name?: string; pane_id?: string; agent_status?: string };
type Frame = {
	event?: string;
	data?: { pane_id?: string; agent_status?: string };
};

const SOCK =
	process.env.HERDR_SOCK ?? join(os.homedir(), ".config/herdr/herdr.sock");
const RECONNECT_MS = 3000;
const TERMINAL = new Set(["done", "idle"]);

export function shouldWake(prev: string | undefined, next: string): boolean {
	return !(TERMINAL.has(prev ?? "") && TERMINAL.has(next));
}

export function pickAgents(
	agents: Agent[],
	wanted: string[],
	selfPane: string,
): Agent[] {
	const others = agents.filter((a) => a.pane_id && a.pane_id !== selfPane);
	if (!wanted.length) return others;
	return others.filter(
		(a) => wanted.includes(a.name ?? "") || wanted.includes(a.pane_id ?? ""),
	);
}

export function transition(
	prev: string | undefined,
	next: string,
): string | undefined {
	if (prev === next) return undefined;
	return `${prev ?? "?"} -> ${next}`;
}

export default function (pi: any) {
	let sock: net.Socket | undefined;
	let gen = 0;
	const status = new Map<string, string>();
	const names = new Map<string, string>();
	const selfPane = process.env.HERDR_PANE_ID ?? "";

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
	const wake = (name: string, change: string) => {
		pi.sendUserMessage(`[fleet] ${name}: ${change}`, { deliverAs: "followUp" });
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

	const start = async (args: string): Promise<string> => {
		stop();
		const myGen = gen;
		const wanted = args
			.trim()
			.split(/[\s,]+/)
			.filter(Boolean);
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
			"Report every status change of other herdr agents as a [fleet] line. Args: agent names; none = all",
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
			"Watch other herdr agents: every status change arrives as a [fleet] <name>: <prev> -> <status> message. Watches only the agents that exist now, so call again after each fleet up. Empty string = every agent but this one.",
		promptSnippet: "watch herdr agents, woken on every status change",
		parameters: {
			type: "object",
			properties: {
				agents: {
					type: "string",
					description:
						"Space- or comma-separated agent names or pane ids; empty string watches all",
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
