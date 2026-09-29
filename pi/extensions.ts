import fleetMonitor from "../extensions/fleet-monitor.ts";
import guard from "../extensions/guard.ts";
import { KINDS, SEATS } from "../src/harness.ts";

export default function (pi: any) {
	fleetMonitor(SEATS.pi)(pi);
	guard(KINDS.pi)(pi);
	pi.registerCommand("clear", {
		description: "Start a new session",
		handler: async (_args: string, ctx: any) => { await ctx.newSession(); },
	});
}
