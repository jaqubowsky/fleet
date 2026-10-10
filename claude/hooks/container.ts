import { readFileSync } from "node:fs";
import { join } from "node:path";
import { record } from "../../extensions/activity.ts";

type HookInput = {
	tool_name?: string;
	tool_input?: { command?: string };
	cwd?: string;
	agent_id?: string;
};

async function refusal(stdin: string): Promise<string | undefined> {
	try {
		const input = JSON.parse(stdin) as HookInput;
		const { pushRefusal } = await import("../../src/guard/container.ts");
		const policy =
			Number(process.env.FLEET_REPOSITORIES) > 1
				? ("host-only" as const)
				: undefined;
		return input.tool_name === "Bash"
			? pushRefusal(
					input.tool_input?.command ?? "",
					input.cwd ?? process.cwd(),
					policy,
				)
			: undefined;
	} catch (error) {
		return `The container guard failed, so this call does not run: ${(error as Error).message}`;
	}
}

if (
	import.meta.filename === process.argv[1] &&
	process.env.FLEET_ARTIFACTS &&
	process.env.SANDBOX_NAME
) {
	const event = process.argv[2] ?? "";
	if (event === "pre-tool-use") {
		const reason = await refusal(readFileSync(0, "utf8"));
		if (reason)
			process.stdout.write(
				JSON.stringify({
					hookSpecificOutput: {
						hookEventName: "PreToolUse",
						permissionDecision: "deny",
						permissionDecisionReason: reason,
					},
				}),
			);
	} else if (event === "post-tool-use" || event === "post-tool-use-failure")
		try {
			const input = JSON.parse(readFileSync(0, "utf8")) as HookInput;
			record(join(process.env.FLEET_ARTIFACTS, process.env.SANDBOX_NAME), {
				tool: input.tool_name ?? "?",
				ok: event === "post-tool-use",
				agent: input.agent_id,
			});
		} catch {}
}
