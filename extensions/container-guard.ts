import { pushRefusal } from "../src/guard/container.ts";
import { translate } from "../src/guard/translate.ts";

type ToolCallEvent = { toolName: string; input?: Record<string, unknown> };

export default function (pi: { on(event: "tool_call", handler: (event: ToolCallEvent, ctx: { cwd: string }) => unknown): void }) {
	if (!process.env.FLEET_ARTIFACTS || !process.env.SANDBOX_NAME) return;
	pi.on("tool_call", (event, ctx) => {
		const payload = translate(event.toolName, event.input ?? {});
		if (payload?.tool_name !== "Bash") return;
		const reason = pushRefusal(String(payload.tool_input.command ?? ""), ctx.cwd);
		return reason ? { block: true, reason } : undefined;
	});
}
