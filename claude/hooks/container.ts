import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deathNote } from "../../extensions/handoff-on-error.ts";
import { COMPLETE, contextNote, pointer, suggested, withAttention } from "../../extensions/session-handoff.ts";

type Usage = { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
type HookInput = { transcript_path?: string; error?: string; error_type?: string; source?: string; agent_id?: string; background_tasks?: unknown[] };

const SUGGESTED = `attention: ${suggested("/clear")}`;
const THRESHOLD = Number(process.env.FLEET_HANDOFF_TOKENS ?? 250000);

export function tail(path: string, bytes = 1 << 20): string {
	const fd = openSync(path, "r");
	try {
		const size = fstatSync(fd).size;
		const start = Math.max(0, size - bytes);
		const buffer = Buffer.alloc(size - start);
		readSync(fd, buffer, 0, buffer.length, start);
		return buffer.toString("utf8");
	} finally {
		closeSync(fd);
	}
}

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

export function handoffNote(status: string, tokens: number, threshold: number, busy = false): string | undefined {
	if (busy || tokens < threshold || !/^attention: none$/m.test(status)) return undefined;
	return withAttention(status, suggested("/clear"));
}

export function contextAdvice(tokens: number, threshold: number): string | undefined {
	return tokens < threshold ? undefined : contextNote(threshold, "end your turn, and the host starts a fresh session");
}

export function clearedNote(status: string): string | undefined {
	if (!status.split("\n").includes(SUGGESTED)) return undefined;
	return withAttention(status, COMPLETE);
}

function next(event: string, status: string, input: HookInput): string | undefined {
	if (event === "stop-failure") return deathNote(status, input.error ?? input.error_type ?? "API error");
	if (event === "session-start") return input.source === "clear" ? clearedNote(status) : undefined;
	if (event !== "stop" || !input.transcript_path) return undefined;
	return handoffNote(status, contextTokens(tail(input.transcript_path)), THRESHOLD, Boolean(input.background_tasks?.length));
}

function adviseOnce(transcript: string): void {
	const marker = join(tmpdir(), `fleet-context-${createHash("sha256").update(transcript).digest("hex").slice(0, 16)}`);
	if (existsSync(marker)) return;
	const note = contextAdvice(contextTokens(tail(transcript)), THRESHOLD);
	if (note === undefined) return;
	writeFileSync(marker, "");
	process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: note } }));
}

if (import.meta.filename === process.argv[1] && process.env.FLEET_ARTIFACTS && process.env.SANDBOX_NAME) {
	const task = join(process.env.FLEET_ARTIFACTS, process.env.SANDBOX_NAME);
	const file = join(task, "status.md");
	const event = process.argv[2] ?? "";
	try {
		const input = JSON.parse(readFileSync(0, "utf8")) as HookInput;
		if (event === "post-tool-use" && input.transcript_path && !input.agent_id) adviseOnce(input.transcript_path);
		const updated = next(event, readFileSync(file, "utf8"), input);
		if (updated !== undefined) writeFileSync(file, updated);
		if (updated !== undefined && event === "session-start")
			process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: pointer(task) } }));
	} catch {}
}
