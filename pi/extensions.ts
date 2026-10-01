import { spawnSync } from "node:child_process";
import fleetMonitor from "../extensions/fleet-monitor.ts";
import guard from "../extensions/guard.ts";
import { KINDS, SEATS } from "../src/harness.ts";

export default function (pi: any) {
	fleetMonitor(SEATS.pi)(pi);
	guard(KINDS.pi)(pi);
	pi.on("session_start", (_event: unknown, ctx: any) => {
		const applied = spawnSync("fleet", ["profile", "--apply", "--brief"], { encoding: "utf8" });
		const text = `${applied.stdout ?? ""}${applied.stderr ?? ""}`.trim();
		if (text) ctx.ui?.notify(`fleet profile --apply: ${text}`, applied.status === 0 ? "info" : "error");
	});
	pi.registerCommand("clear", {
		description: "Start a new session",
		handler: async (_args: string, ctx: any) => { await ctx.newSession(); },
	});
}
