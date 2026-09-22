export type Message = {
	role: "user" | "assistant" | "toolResult";
	text: string;
};
export type Tool = {
	id: string;
	name: string;
	state: "running" | "done" | "error";
	text: string;
};

export function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function text(value: unknown, limit = 4096): string {
	return typeof value === "string" ? value.slice(0, limit) : "";
}

export function content(value: unknown): string {
	if (typeof value === "string") return text(value);
	if (!Array.isArray(value)) return "";
	return value
		.slice(0, 64)
		.map((block) => {
			const item = record(block);
			return item.type === "text" ? text(item.text) : "";
		})
		.filter(Boolean)
		.join("\n")
		.slice(0, 4096);
}

export function message(value: unknown): Message | undefined {
	const item = record(value);
	if (
		item.role !== "user" &&
		item.role !== "assistant" &&
		item.role !== "toolResult"
	)
		return;
	return { role: item.role, text: content(item.content) };
}

export function transcript(entries: unknown[]): Message[] {
	return entries.slice(-64).flatMap((entry) => {
		const item = record(entry);
		const projected =
			item.type === "message" ? message(item.message) : undefined;
		return projected ? [projected] : [];
	});
}
