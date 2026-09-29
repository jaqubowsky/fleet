import { homedir } from "node:os";
import { downPermission, sandboxDownTarget } from "../src/guard/down.ts";
import type { Kind } from "../src/harness.ts";
import { hostAt } from "../src/guard/host.ts";
import { OWN_CONFIG, writesOwnConfig } from "../src/guard/own-config.ts";
import { decide } from "../src/guard/policy.ts";
import { TRUSTED, translate } from "../src/guard/translate.ts";

type ToolCallEvent = { toolName: string; input?: Record<string, unknown> };
type GuardContext = {
	cwd: string;
	hasUI?: boolean;
	ui?: { confirm(title: string, message: string): Promise<boolean> };
};
type GuardApi = {
	on(
		event: "tool_call",
		handler: (event: ToolCallEvent, ctx: GuardContext) => unknown,
	): void;
};

export default function guard(
	h: Kind,
	root?: string,
	home = homedir(),
	level = (sandbox: string) => sandboxDownTarget(sandbox, root, home),
) {
	const trusted = TRUSTED[h.name] ?? new Set<string>();
	return (pi: GuardApi) => {
		pi.on("tool_call", (event, ctx) => {
			if (trusted.has(event.toolName)) return;

			if (event.toolName === "bash") {
				const down = downPermission(String(event.input?.command ?? ""), level);
				if (down?.decision === "deny") return { block: true, reason: down.reason };
				if (down?.decision === "ask") {
					if (!ctx.hasUI || !ctx.ui) return { block: true, reason: down.reason };
					return ctx.ui
						.confirm("Close container?", `Run fleet down ${down.sandbox}?`)
						.then((approved) =>
							approved ? undefined : { block: true, reason: down.reason },
						);
				}
				if (down) return;
			}

			const payload = translate(event.toolName, event.input ?? {});
			if (!payload)
				return { block: true, reason: `Unknown tool policy: ${event.toolName}` };

			if (writesOwnConfig(payload.tool_name, payload.tool_input, ctx.cwd, home))
				return { block: true, reason: OWN_CONFIG };

			const verdict = decide(
				payload.tool_name,
				payload.tool_input,
				hostAt(ctx.cwd, root, home),
			);
			if (verdict.decision === "allow") return;

			return { block: true, reason: verdict.reason };
		});
	};
}
