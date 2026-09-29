import { unwatchFile, watchFile } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { Harness } from "../src/harness.ts";
import { eventAgents, eventsLog, lifecycle } from "../src/fleet/events.ts";
import { type Io, realIo } from "../src/fleet/io.ts";
import { wakeName, watch } from "../src/fleet/watch.ts";

const LOG_POLL_MS = 2000;

export default function fleetMonitor(h: Harness, io: Io = realIo(os.homedir(), h)) {
	return (pi: any) => {
		const log = join(io.home, eventsLog(h));
		let ui: any = pi.ui;
		let sessionId: string | undefined;
		let named: string[] = [];
		let every = false;
		let watcher: ReturnType<typeof watch> | undefined;

		const owned = () => eventAgents(io.read(log) ?? "", h.owner === "session" ? { sessionId } : { pane: io.pane });
		const scope = () => (every ? undefined : [...named, ...owned()]);
		let running = false;
		const held: string[] = [];
		const send = (text: string) => {
			pi.sendMessage({ customType: "fleet", content: text, display: true }, { deliverAs: "followUp", triggerTurn: true });
			ui?.notify?.(text.split("\n")[0], "info");
		};
		const deliver = (text: string) => {
			if (running) held.push(text);
			else send(text);
		};
		const release = () => {
			running = false;
			const { closed } = lifecycle(io.read(log) ?? "");
			const kept = held.splice(0).filter((text) => !closed.has(wakeName(text) ?? "") || text.split("\n")[0].endsWith(" -> taken down"));
			if (kept.length) send(kept.join("\n\n"));
		};
		const said = new Set<string>();
		const say = (line: string) => {
			if (!said.has(line)) ui?.notify?.(line, "info");
			said.add(line);
		};
		const restart = () => {
			watcher?.stop();
			said.clear();
			watcher = watch(scope, { ...io, log: say }, deliver);
		};
		const fleetCommand = new RegExp(`(^|[\\s;&|(])${h.cli}\\s`);
		const refresh = () => watcher?.refresh();
		const start = (args: string) => {
			named = args.trim().split(/[\s,]+/).filter(Boolean);
			every = !named.length;
			restart();
			return every ? "watching every container" : `watching ${named.join(", ")}`;
		};
		const unwatch = () => {
			named = [];
			every = false;
			restart();
			return "stopped";
		};

		pi.registerCommand("fleet-watch", {
			description:
				"Watch containers beyond the ones this session put up or steered; one settling or working on without settling wakes this session with a [fleet] line. Args: sandbox names; none = every container",
			handler: async (args: string, ctx: any) => ctx.ui?.notify(`fleet: ${start(args)}`, "info"),
		});
		pi.registerCommand("fleet-unwatch", {
			description: "Stop the watch started by /fleet-watch",
			handler: async (_args: string, ctx: any) => ctx.ui?.notify(`fleet: ${unwatch()}`, "info"),
		});
		pi.registerTool({
			name: "fleet_watch",
			label: "Fleet watch",
			description:
				`Watch containers beyond the ones this session put up or steered, which are watched by themselves. A container settling (done, idle, blocked, gone, taken down), working 20 minutes without settling, or idle 20 minutes short of ready-for-host, paused or blocked wakes this session with a [fleet] <agent>: <sandbox> <change> line (the sandbox named only where herdr shortened the agent) carrying a bounded projection of status.md (status, attention, the number of Log lines added since its previous wake), commit counts since origin's default branch, and the pull request with its CI; a settle with the pull request open and CI running wakes nothing unless status.md is blocked or paused. That turn is where you act on it. Pass the sandbox name from ${h.cli} ls; empty string = every container.`,
			promptSnippet: "watch containers; a settling one wakes this session with a [fleet] line",
			parameters: {
				type: "object",
				properties: {
					agents: {
						type: "string",
						description: `Space- or comma-separated sandbox names as ${h.cli} ls prints them (${h.prefix}<repo>-<label>). Empty string watches every container`,
					},
				},
				required: ["agents"],
			},
			async execute(_id: string, params: { agents?: string }) {
				return { content: [{ type: "text", text: `fleet: ${start(params.agents ?? "")}` }] };
			},
		});
		pi.registerTool({
			name: "fleet_unwatch",
			label: "Fleet unwatch",
			description: "Stop the watch started by fleet_watch.",
			parameters: { type: "object", properties: {} },
			async execute() {
				return { content: [{ type: "text", text: `fleet: ${unwatch()}` }] };
			},
		});
		pi.on("session_start", (_event: unknown, ctx: any) => {
			sessionId = ctx.sessionManager?.getSessionId?.();
			if (sessionId && h.sessionIdEnv) process.env[h.sessionIdEnv] = sessionId;
			ui = ctx.ui ?? ui;
			restart();
			watchFile(log, { interval: LOG_POLL_MS }, refresh);
		});
		pi.on("tool_call", (event: { toolName: string; input: { command?: unknown } }) => {
			const command = event.input?.command;
			if (event.toolName !== "bash" || !sessionId || !h.sessionIdEnv || typeof command !== "string" || !fleetCommand.test(command)) return;
			event.input.command = `export ${h.sessionIdEnv}=${JSON.stringify(sessionId)}; ${command}`;
			return { input: event.input };
		});
		pi.on("agent_start", () => {
			running = true;
		});
		pi.on("agent_end", release);
		pi.on("session_shutdown", () => {
			watcher?.stop();
			watcher = undefined;
			unwatchFile(log, refresh);
		});
	};
}
