import { decide } from "../../src/guard/policy.ts";
import { TRUSTED, translate } from "../../src/guard/translate.ts";

type ToolCallEvent = { toolName: string; input?: Record<string, unknown> };
type GuardApi = {
	on(event: "tool_call", handler: (event: ToolCallEvent) => unknown): void;
};

export default function (pi: GuardApi) {
	pi.on("tool_call", (event) => {
		if (TRUSTED.has(event.toolName)) return;

		const payload = translate(event.toolName, event.input ?? {});
		if (!payload)
			return { block: true, reason: `Unknown tool policy: ${event.toolName}` };

		const verdict = decide(payload.tool_name, payload.tool_input);
		if (verdict.decision === "allow") return;

		return { block: true, reason: verdict.reason };
	});
}
