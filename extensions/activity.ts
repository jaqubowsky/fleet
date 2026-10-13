import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ACTIVITY = "logs/activity.jsonl";
export const PULL_REQUEST = "logs/pull-request.json";

const PULL_REQUEST_URL = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/g;

export function record(taskDirectory: string, call: { tool: string; ok: boolean; agent?: string }, at = new Date()): void {
	mkdirSync(join(taskDirectory, "logs"), { recursive: true });
	appendFileSync(join(taskDirectory, ACTIVITY), `${JSON.stringify({ at: at.toISOString(), tool: call.tool, ok: call.ok, agent: call.agent ?? "main" })}\n`);
}

export function recordPullRequest(taskDirectory: string, command: string, output: string): void {
	const opened = command.includes("gh pr create") ? [...output.matchAll(PULL_REQUEST_URL)].at(-1) : undefined;
	if (!opened) return;
	mkdirSync(join(taskDirectory, "logs"), { recursive: true });
	writeFileSync(join(taskDirectory, PULL_REQUEST), JSON.stringify({ number: Number(opened[1]), url: opened[0] }));
}

export default function (pi: any) {
	if (!process.env.FLEET_ARTIFACTS || !process.env.SANDBOX_NAME) return;
	const taskDirectory = join(process.env.FLEET_ARTIFACTS, process.env.SANDBOX_NAME);
	pi.on("tool_execution_end", (event: { toolName: string; isError: boolean }) => {
		record(taskDirectory, { tool: event.toolName, ok: !event.isError });
	});
	pi.on("tool_result", (event: { toolName: string; input: { command?: unknown }; content: { text?: string }[] }) => {
		if (event.toolName === "bash") recordPullRequest(taskDirectory, String(event.input.command ?? ""), event.content.map((part) => part.text ?? "").join("\n"));
	});
}
