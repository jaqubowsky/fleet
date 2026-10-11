import { basename } from "node:path";
import type { Kind } from "../harness.ts";
import type { Io } from "./io.ts";

type Line = {
	message?: {
		role?: string;
		content?: { type?: string; text?: string }[];
		stopReason?: string;
		errorMessage?: string;
	};
};

const FAILED = new Set(["error", "aborted"]);

export function sessionsDir(task: string, kind: Kind, workspace: string): string {
	return kind.containerSessions
		? `${task}/logs/sessions/${basename(kind.containerSessions)}/${claudeProject(workspace)}`
		: `${task}/logs/sessions`;
}

export function claudeProject(workspace: string): string {
	return workspace.replace(/[^a-zA-Z0-9]/g, "-");
}

export function lastMessage(dir: string, io: Io): string | undefined {
	const newest = io
		.list(dir)
		.filter((file) => file.endsWith(".jsonl"))
		.map((file) => `${dir}/${file}`)
		.sort((a, b) => (io.stat(b)?.mtime.getTime() ?? 0) - (io.stat(a)?.mtime.getTime() ?? 0))[0];
	return newest ? said(io.read(newest) ?? "") : undefined;
}

function said(jsonl: string): string | undefined {
	for (const line of jsonl.split("\n").reverse()) {
		let entry: Line;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		const message = entry.message;
		if (message?.role !== "assistant") continue;
		const text = (message.content ?? [])
			.flatMap((part) => (part.type === "text" && part.text?.trim() ? [part.text.trim()] : []))
			.join("\n");
		const stop = FAILED.has(message.stopReason ?? "")
			? `stopped on ${message.stopReason}${message.errorMessage ? `: ${message.errorMessage}` : ""}`
			: "";
		const both = [text, stop].filter(Boolean).join("\n\n");
		if (both) return both;
	}
}
