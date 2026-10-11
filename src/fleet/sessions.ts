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
	const replies = jsonl.split("\n").flatMap((line) => {
		try {
			const entry: Line = JSON.parse(line);
			return entry.message?.role === "assistant" ? [entry.message] : [];
		} catch {
			return [];
		}
	});
	const text = replies
		.map((reply) =>
			(reply.content ?? [])
				.flatMap((part) => (part.type === "text" && part.text?.trim() ? [part.text.trim()] : []))
				.join("\n"),
		)
		.filter(Boolean)
		.at(-1);
	const last = replies.at(-1);
	const stop =
		last && FAILED.has(last.stopReason ?? "")
			? `stopped on ${last.stopReason}${last.errorMessage ? `: ${last.errorMessage}` : ""}`
			: undefined;
	return [text, stop].filter(Boolean).join("\n\n") || undefined;
}
