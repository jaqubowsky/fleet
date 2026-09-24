import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { snapshot } from "./status-history.ts";

type Message = { role?: string; stopReason?: string; errorMessage?: string };

export const STOPPED = "the agent stopped on an error";

export function deathNote(status: string | undefined, error: string): string | undefined {
	if (status === undefined) return undefined;
	const current = status.match(/^status: (.*)$/m)?.[1];
	if (current === undefined || current === "blocked") return undefined;
	const attention = `attention: ${STOPPED}: ${error.split("\n")[0]}`;
	const lines = status.split("\n").filter((l) => !l.startsWith("attention: "));
	const at = lines.findIndex((l) => l.startsWith("status: "));
	lines[at] = "status: blocked";
	lines.splice(at + 1, 0, attention);
	return lines.join("\n");
}

export default function (pi: any) {
	const sessions = process.env.PI_CODING_AGENT_SESSION_DIR;
	if (!sessions) return;
	const file = join(dirname(dirname(sessions)), "status.md");
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
		writeFileSync(file, next);
		snapshot(dirname(file));
	});
}
