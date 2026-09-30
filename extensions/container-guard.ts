import { pushRefusal } from "../src/guard/container.ts";
import { translate } from "../src/guard/translate.ts";

type ToolCallEvent = { toolName: string; input?: Record<string, unknown> };

export default function (pi: {
	on(
		event: "tool_call",
		handler: (event: ToolCallEvent, ctx: { cwd: string }) => unknown,
	): void;
}) {
	const artifacts = process.env.FLEET_ARTIFACTS;
	const sandbox = process.env.SANDBOX_NAME;
	if (!artifacts || !sandbox) return;
	const policy =
		Number(process.env.FLEET_REPOSITORIES) > 1
			? ("host-only" as const)
			: undefined;
	pi.on("tool_call", (event, ctx) => {
		const payload = translate(event.toolName, event.input ?? {});
		if (payload?.tool_name !== "Bash") return;
		const reason = pushRefusal(
			String(payload.tool_input.command ?? ""),
			ctx.cwd,
			policy,
		);
		return reason ? { block: true, reason } : undefined;
	});
}
