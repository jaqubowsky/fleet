import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const ACTIVITY = "logs/activity.jsonl";

export function record(taskDirectory: string, call: { tool: string; ok: boolean; agent?: string }, at = new Date()): void {
	mkdirSync(join(taskDirectory, "logs"), { recursive: true });
	appendFileSync(join(taskDirectory, ACTIVITY), `${JSON.stringify({ at: at.toISOString(), tool: call.tool, ok: call.ok, agent: call.agent ?? "main" })}\n`);
}

export default function (pi: any) {
	if (!process.env.FLEET_ARTIFACTS || !process.env.SANDBOX_NAME) return;
	const taskDirectory = join(process.env.FLEET_ARTIFACTS, process.env.SANDBOX_NAME);
	pi.on("tool_execution_end", (event: { toolName: string; isError: boolean }) => {
		record(taskDirectory, { tool: event.toolName, ok: !event.isError });
	});
}
