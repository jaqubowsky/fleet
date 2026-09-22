import { SECRET_MATERIAL } from "../guard/policy.ts";

export type TextBlock = { kind: "text"; text: string };
export type ToolBlock = {
	kind: "tool";
	id: string;
	name: string;
	summary: string;
	state: "running" | "done" | "error";
	result: string;
	diff?: string;
};
export type Block = TextBlock | ToolBlock;
export type Header = {
	cwd?: string;
	model?: string;
	percent?: number;
	cost?: number;
	queued: boolean;
};
export type Message = {
	role: "user" | "assistant";
	blocks: Block[];
	at?: number;
};

const ENTRY_LIMIT = 1024;
export const MESSAGE_LIMIT = 64;
const BLOCK_LIMIT = 32;
const TEXT_LIMIT = 4096;
const SUMMARY_LIMIT = 200;
export const SNAPSHOT_LIMIT = 524_288;
const SECRETS = new RegExp(SECRET_MATERIAL.source, "g");

export function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function mask(value: unknown): string {
	return typeof value === "string" ? value.replace(SECRETS, "[redacted]") : "";
}

export function text(value: unknown, limit = TEXT_LIMIT): string {
	return mask(value).slice(0, limit);
}

const omitted = (count: number) => `\n… ${count} characters omitted …\n`;

export function clamp(value: string, limit = TEXT_LIMIT): string {
	if (value.length <= limit) return value;
	const keep = Math.max(0, limit - omitted(value.length).length);
	const head = Math.ceil(keep * 0.6);
	const tail = keep - head;
	return (
		value.slice(0, head) +
		omitted(value.length - keep) +
		(tail ? value.slice(value.length - tail) : "")
	);
}

export function content(value: unknown): string {
	if (typeof value === "string") return text(value);
	if (!Array.isArray(value)) return "";
	return clamp(
		value
			.slice(0, 64)
			.map((block) => {
				const item = record(block);
				return item.type === "text" ? mask(item.text) : "";
			})
			.filter(Boolean)
			.join("\n"),
	);
}

const string = (value: unknown): string =>
	typeof value === "string" ? value : "";
const located = (args: Record<string, unknown>): string =>
	[string(args.pattern), string(args.path)].filter(Boolean).join(" in ");

const SUMMARIES: Record<string, (args: Record<string, unknown>) => string> = {
	bash: (args) => string(args.command),
	read: (args) => string(args.path),
	write: (args) => string(args.path),
	edit: (args) => string(args.path),
	ls: (args) => string(args.path) || ".",
	grep: located,
	find: located,
	web_search: (args) => string(args.query),
	source_check: (args) => string(args.query) || string(args.url),
	get_search_content: (args) => string(args.query) || string(args.url),
	fetch_content: (args) =>
		string(args.url) ||
		(Array.isArray(args.urls) ? args.urls.map(string).join(", ") : ""),
	subagent: (args) =>
		[string(args.agent), string(args.task)].filter(Boolean).join(": "),
};
const PREFERRED = ["command", "path", "pattern", "query", "url", "task"];

export function summarize(name: string, args: Record<string, unknown>): string {
	const own = SUMMARIES[name]?.(args);
	if (own) return text(own, SUMMARY_LIMIT);
	const key = PREFERRED.find((field) => string(args[field]));
	if (key) return text(string(args[key]), SUMMARY_LIMIT);
	const keys = Object.keys(args).slice(0, 6);
	return text(keys.length ? `${name}(${keys.join(", ")})` : name, SUMMARY_LIMIT);
}

function edited(args: Record<string, unknown>): string {
	const edits = Array.isArray(args.edits) ? args.edits : [];
	return edits
		.flatMap((value) => {
			const edit = record(value);
			return [
				...string(edit.oldText)
					.split("\n")
					.map((line) => `-${line}`),
				...string(edit.newText)
					.split("\n")
					.map((line) => `+${line}`),
			];
		})
		.join("\n");
}

export function call(value: unknown): ToolBlock {
	const item = record(value);
	const name = text(item.name, 128);
	const args = record(item.arguments);
	const diff = name === "edit" ? clamp(mask(edited(args))) : "";
	return {
		kind: "tool",
		id: text(item.id, 128),
		name,
		summary: summarize(name, args),
		state: "running",
		result: "",
		...(diff ? { diff } : {}),
	};
}

export function settle(
	block: ToolBlock,
	isError: unknown,
	result: unknown,
	details: unknown,
): ToolBlock {
	const patch = mask(record(details).patch);
	return {
		...block,
		state: isError ? "error" : "done",
		result: content(result),
		...(patch ? { diff: clamp(patch) } : {}),
	};
}

const DATE_LIMIT = 8_640_000_000_000_000;

function moment(...candidates: unknown[]): number | undefined {
	for (const value of candidates) {
		const at = typeof value === "string" ? Date.parse(value) : value;
		if (typeof at === "number" && Number.isFinite(at) && Math.abs(at) <= DATE_LIMIT)
			return at;
	}
	return undefined;
}

export function message(value: unknown, at?: unknown): Message | undefined {
	const item = record(value);
	if (item.role !== "user" && item.role !== "assistant") return;
	const blocks: Block[] =
		typeof item.content === "string"
			? [{ kind: "text", text: clamp(mask(item.content)) }]
			: (Array.isArray(item.content) ? item.content : [])
					.map((entry) => {
						const part = record(entry);
						if (part.type === "text")
							return { kind: "text", text: clamp(mask(part.text)) } as Block;
						if (part.type === "toolCall") return call(part);
						return undefined;
					})
					.filter((block): block is Block => block !== undefined)
					.slice(0, BLOCK_LIMIT);
	const when = moment(item.timestamp, at);
	return {
		role: item.role,
		blocks: blocks.filter(filled),
		...(when === undefined ? {} : { at: when }),
	};
}

const filled = (block: Block) => block.kind === "tool" || block.text !== "";

export function transcript(entries: unknown[]): Message[] {
	const messages: Message[] = [];
	const pending = new Map<string, ToolBlock>();
	for (const entry of entries.slice(-ENTRY_LIMIT)) {
		const item = record(entry);
		if (item.type !== "message") continue;
		const value = record(item.message);
		if (value.role === "toolResult") {
			const block = pending.get(text(value.toolCallId, 128));
			if (block)
				Object.assign(
					block,
					settle(block, value.isError, value.content, value.details),
				);
			continue;
		}
		const projected = message(value, item.timestamp);
		if (!projected) continue;
		for (const block of projected.blocks)
			if (block.kind === "tool") pending.set(block.id, block);
		messages.push(projected);
	}
	return fit(messages.slice(-MESSAGE_LIMIT));
}

export function fit(messages: Message[], budget = SNAPSHOT_LIMIT): Message[] {
	const kept: Message[] = [];
	let total = 0;
	for (let index = messages.length - 1; index >= 0; index--) {
		total += JSON.stringify(messages[index]).length + 1;
		if (total > budget && kept.length) break;
		kept.unshift(messages[index]);
	}
	return kept;
}

const rounded = (value: unknown, places: number): number | undefined =>
	typeof value === "number" && Number.isFinite(value)
		? Number(value.toFixed(places))
		: undefined;

export function header(value: unknown): Header {
	const item = record(value);
	const cwd = text(item.cwd, 256);
	const model = text(item.model, 128);
	const percent = rounded(item.percent, 0);
	const cost = rounded(item.cost, 2);
	return {
		...(cwd ? { cwd } : {}),
		...(model ? { model } : {}),
		...(percent === undefined ? {} : { percent }),
		...(cost === undefined ? {} : { cost }),
		queued: item.queued === true,
	};
}
