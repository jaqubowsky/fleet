import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deathNote } from "../../extensions/handoff-on-error.ts";

type Usage = { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
type HookInput = { transcript_path?: string; error?: string; error_type?: string };

export const HANDOFF = "attention: session handoff requested; the host clears this session with /clear once it is idle";

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
	return status.replace(/^attention: none$/m, HANDOFF);
}

function next(event: string, status: string, input: HookInput): string | undefined {
	if (event === "stop-failure") return deathNote(status, input.error ?? input.error_type ?? "API error");
	if (event !== "stop" || !input.transcript_path) return undefined;
	const threshold = Number(process.env.FLEET_HANDOFF_TOKENS ?? 250000);
	return handoffNote(status, contextTokens(readFileSync(input.transcript_path, "utf8")), threshold);
}

if (import.meta.filename === process.argv[1] && process.env.FLEET_ARTIFACTS && process.env.SANDBOX_NAME) {
	const file = join(process.env.FLEET_ARTIFACTS, process.env.SANDBOX_NAME, "status.md");
	try {
		const updated = next(process.argv[2] ?? "", readFileSync(file, "utf8"), JSON.parse(readFileSync(0, "utf8")) as HookInput);
		if (updated !== undefined) writeFileSync(file, updated);
	} catch {}
}
