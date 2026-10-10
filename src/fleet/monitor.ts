export const SETTLE_MS = 1000;
export const STALL_MS = 20 * 60_000;
export const RING_MS = 15 * 60_000;
export const TAIL_LINES = 15;
export const TERMINAL = new Set(["done", "idle"]);
const WAKE = new Set(["done", "idle", "blocked"]);

export function shouldWake(prev: string | undefined, next: string): boolean {
	if (next === "unknown") return prev === "working";
	if (TERMINAL.has(prev ?? "") && TERMINAL.has(next)) return false;

	return WAKE.has(next);
}

export function stalled(
	entries: { pane: string; status: string; since: number; rang: number }[],
	now: number,
	stallMs: number,
	ringMs: number,
): string[] {
	return entries
		.filter(
			(e) =>
				e.status === "working" &&
				now - e.since >= stallMs &&
				now - e.rang >= ringMs,
		)
		.map((e) => e.pane);
}

export type Label = "question" | "turn ended" | "no closing message";

export function closingLabel(tail: string): Label {
	const question = tail
		.split("\n")
		.map((line) => line.match(/\bQuestion:\s*(.*?)[\s│|]*$/)?.[1])
		.filter((answer) => answer !== undefined)
		.at(-1);
	if (question === undefined || question === "") return "no closing message";
	return /^none\.?$/i.test(question) ? "turn ended" : "question";
}

export function transition(
	prev: string | undefined,
	next: string,
): string | undefined {
	if (prev === next) return undefined;
	return `${prev ?? "?"} -> ${next}`;
}
