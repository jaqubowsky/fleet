import { STOPPED } from "../../extensions/handoff-on-error.ts";

const RETRY_MS = 30 * 60_000;
export const RETRIES = 10;

const LIMIT = /rate.?limit|session limit|usage limit/i;
const RESET = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi;

export function limitStop(attention: string | undefined): boolean {
	return !!attention?.startsWith(STOPPED) && LIMIT.test(attention);
}

export function resetAt(text: string, after: Date): Date | undefined {
	const last = [...text.matchAll(RESET)].at(-1);
	if (!last) return undefined;
	const [, hour, minute = "0", half] = last;
	const at = new Date(after);
	at.setHours((Number(hour) % 12) + (half.toLowerCase() === "pm" ? 12 : 0), Number(minute), 0, 0);
	if (at <= after) at.setDate(at.getDate() + 1);
	return at;
}

export function resumeDue(stoppedAt: Date, reset: Date | undefined, resumes: Date[]): Date {
	const last = resumes.at(-1);
	return last ? new Date(last.getTime() + RETRY_MS) : (reset ?? new Date(stoppedAt.getTime() + RETRY_MS));
}
