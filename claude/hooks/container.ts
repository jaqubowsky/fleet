import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deathNote } from "../../extensions/handoff-on-error.ts";
import { COMPLETE, pointer, suggested, withAttention } from "../../extensions/session-handoff.ts";

type Usage = { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
type HookInput = { transcript_path?: string; error?: string; error_type?: string; source?: string };

const SUGGESTED = `attention: ${suggested("/clear")}`;

export function contextTokens(transcript: string): number {
	const lines = transcript.trimEnd().split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		let usage: Usage | undefined;
		try {
			const entry = JSON.parse(lines[i]);
			usage = entry.type === "assistant" ? entry.message?.usage : undefined;
		} catch {
			continue;
		}
		if (usage) return (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
	}
	return 0;
}

export function handoffNote(status: string, tokens: number, threshold: number): string | undefined {
	if (tokens < threshold || !/^attention: none$/m.test(status)) return undefined;
	return withAttention(status, suggested("/clear"));
}

export function clearedNote(status: string): string | undefined {
	if (!status.split("\n").includes(SUGGESTED)) return undefined;
	return withAttention(status, COMPLETE);
}

function next(event: string, status: string, input: HookInput): string | undefined {
	if (event === "stop-failure") return deathNote(status, input.error ?? input.error_type ?? "API error");
	if (event === "session-start") return input.source === "clear" ? clearedNote(status) : undefined;
	if (event !== "stop" || !input.transcript_path) return undefined;
	const threshold = Number(process.env.FLEET_HANDOFF_TOKENS ?? 250000);
	return handoffNote(status, contextTokens(readFileSync(input.transcript_path, "utf8")), threshold);
}

if (import.meta.filename === process.argv[1] && process.env.FLEET_ARTIFACTS && process.env.SANDBOX_NAME) {
	const task = join(process.env.FLEET_ARTIFACTS, process.env.SANDBOX_NAME);
	const file = join(task, "status.md");
	const event = process.argv[2] ?? "";
	try {
		const updated = next(event, readFileSync(file, "utf8"), JSON.parse(readFileSync(0, "utf8")) as HookInput);
		if (updated !== undefined) writeFileSync(file, updated);
		if (updated !== undefined && event === "session-start")
			process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: pointer(task) } }));
	} catch {}
}
