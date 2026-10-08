import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { changes, fieldsOf, snapshot, STATUS_LOG } from "./status-history.ts";

type Message = { role?: string; stopReason?: string; errorMessage?: string };

export const STOPPED = "the agent stopped on an error";

export function deathNote(status: string | undefined, error: string): string | undefined {
	if (status === undefined) return undefined;
	const current = status.match(/^status: (.*)$/m)?.[1];
	if (current === undefined) return undefined;
	if (current === "blocked" && !fieldsOf(status).attention?.startsWith(`${STOPPED}: `)) return undefined;
	const attention = `attention: ${STOPPED}: ${error.split("\n")[0]}`;
	const lines = status.split("\n").filter((l) => !l.startsWith("attention: "));
	const at = lines.findIndex((l) => l.startsWith("status: "));
	lines[at] = "status: blocked";
	lines.splice(at + 1, 0, attention);
	return lines.join("\n");
}

export function resumeAfterError(task: string): void {
	const file = join(task, "status.md");
	let status: string;
	try {
		status = readFileSync(file, "utf8");
	} catch {
		return;
	}
	const current = fieldsOf(status);
	if (!current.attention?.startsWith(`${STOPPED}: `)) return;
	let phase = current.status;
	if (phase === "blocked") {
		phase = changes(readFileSync(join(task, STATUS_LOG), "utf8"))
			.reverse().find((change) => !change.attention?.startsWith(`${STOPPED}: `))?.status;
		if (!phase) return;
	}
	writeFileSync(file, status
		.replace(/^status: .*$/m, `status: ${phase}`)
		.replace(/^attention: .*$/m, "attention: none"));
	snapshot(task);
}

export default function (pi: any) {
	const sessions = process.env.PI_CODING_AGENT_SESSION_DIR;
	if (!sessions) return;
	const task = dirname(dirname(sessions));
	const file = join(task, "status.md");
	pi.on("tool_execution_end", (event: { isError: boolean; parentToolCallId?: string }) => {
		if (!event.isError && !event.parentToolCallId) resumeAfterError(task);
	});
	pi.on("agent_end", (event: { messages?: Message[] }) => {
		const last = event.messages?.at(-1);
		if (last?.role !== "assistant" || last.stopReason !== "error") return;
		let status: string | undefined;
		try {
			status = readFileSync(file, "utf8");
		} catch {
			return;
		}
		const next = deathNote(status, last.errorMessage ?? "unknown error");
		if (next === undefined) return;
		snapshot(task);
		writeFileSync(file, next);
		snapshot(task);
	});
}
