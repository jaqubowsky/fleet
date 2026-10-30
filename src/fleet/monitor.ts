export const SETTLE_MS = 1000;
export const STALL_MS = 20 * 60_000;
export const RING_MS = 15 * 60_000;
export const TERMINAL = new Set(["done", "idle"]);
const WAKE = new Set(["done", "idle", "blocked", "error"]);

export function shouldWake(prev: string | undefined, next: string): boolean {
	if (next === "unknown") return prev === "working";
	if (TERMINAL.has(prev ?? "") && TERMINAL.has(next)) return false;

	return WAKE.has(next);
}

export function stalled(
	entries: { name: string; status: string; since: number; rang: number }[],
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
		.map((e) => e.name);
}

export function transition(
	prev: string | undefined,
	next: string,
): string | undefined {
	if (prev === next) return undefined;
	return `${prev ?? "?"} -> ${next}`;
}
