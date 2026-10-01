import { calls, elapsed } from "./status.ts";

type Call = { at: string; tool: string; ok: boolean; agent: string };
type Streak = { length: number; from: string };

type Activity = { started: string; last: string; calls: number; lastTool: string; streak: number; streakFrom?: string };

function callsOf(jsonl: string | undefined): Call[] {
	return (jsonl ?? "").split("\n").flatMap((line): Call[] => {
		try {
			return line.trim() ? [JSON.parse(line)] : [];
		} catch {
			return [];
		}
	});
}

export function activityOf(jsonl: string | undefined): Activity | undefined {
	const calls = callsOf(jsonl);
	if (!calls.length) return undefined;
	const streaks = new Map<string, Streak>();
	for (const call of calls) {
		const current = streaks.get(call.agent);
		streaks.set(call.agent, call.ok ? { length: 0, from: "" } : { length: (current?.length ?? 0) + 1, from: current?.length ? current.from : call.at });
	}
	const longest = [...streaks.values()].reduce((a, b) => (b.length > a.length ? b : a));
	const last = calls[calls.length - 1];
	return {
		started: calls[0].at,
		last: last.at,
		calls: calls.length,
		lastTool: last.tool,
		streak: longest.length,
		streakFrom: longest.length ? longest.from : undefined,
	};
}

export function callsSince(jsonl: string | undefined, from: Date): number {
	return callsOf(jsonl).filter((call) => new Date(call.at) >= from).length;
}

export function projection(activity: Activity | undefined, cost: number | undefined, now: Date): string {
	return [
		...(activity
			? [
					`up ${elapsed(new Date(activity.started), now)}`,
					`silent ${elapsed(new Date(activity.last), now)}`,
					calls(activity.calls),
					`last ${activity.lastTool}`,
					...(activity.streak ? [`${activity.streak} failed in a row`] : []),
				]
			: []),
		...(cost === undefined ? [] : [`$${cost.toFixed(2)}`]),
	].join(", ");
}
