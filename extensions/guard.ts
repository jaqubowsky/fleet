import { homedir } from "node:os";
import type { Harness } from "../src/harness.ts";
import { hostAt } from "../src/guard/host.ts";
import { OWN_CONFIG, writesOwnConfig } from "../src/guard/own-config.ts";
import { decide } from "../src/guard/policy.ts";
import { TRUSTED, translate } from "../src/guard/translate.ts";

type ToolCallEvent = { toolName: string; input?: Record<string, unknown> };
type GuardApi = {
	on(event: "tool_call", handler: (event: ToolCallEvent, ctx: { cwd: string }) => unknown): void;
};

export default function guard(h: Harness, root?: string, home = homedir()) {
	const trusted = TRUSTED[h.name] ?? new Set<string>();
	return (pi: GuardApi) => {
		pi.on("tool_call", (event, ctx) => {
			if (trusted.has(event.toolName)) return;

			const payload = translate(event.toolName, event.input ?? {});
			if (!payload)
				return { block: true, reason: `Unknown tool policy: ${event.toolName}` };

			if (writesOwnConfig(payload.tool_name, payload.tool_input, ctx.cwd, home)) return { block: true, reason: OWN_CONFIG };

			const verdict = decide(payload.tool_name, payload.tool_input, hostAt(ctx.cwd, root, home));
			if (verdict.decision === "allow") return;

			return { block: true, reason: verdict.reason };
		});
	};
}
