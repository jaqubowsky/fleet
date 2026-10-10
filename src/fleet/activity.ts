import { calls, elapsed } from "./status.ts";
import type { Runtime } from "./events.ts";
import { STALL_MS } from "./monitor.ts";

type Call = { at: string; tool: string; ok: boolean; agent: string };
type Streak = { length: number };

type Activity = { started: string; last: string; calls: number; lastTool: string; streak: number };

function callsOf(jsonl: string | undefined): Call[] {
	return (jsonl ?? "").split("\n").flatMap((line): Call[] => {
		try {
			return line.trim() ? [JSON.parse(line)] : [];
		} catch {
			return [];
		}
	});
}

type Counts = { calls: number; failed: number };
export type ToolUsage = Counts & {
	by_tool: Record<string, Counts>;
	by_agent: Record<string, Counts>;
	silence_threshold_ms?: number;
	activity_gaps?: { from: string; to: string; running_ms: number }[];
};

export function toolUsage(jsonl: string | undefined, runtime: Runtime): ToolUsage | undefined {
	if (jsonl === undefined) return undefined;
	const totals: ToolUsage = { calls: 0, failed: 0, by_tool: {}, by_agent: {} };
	const from = runtime.coverage === "complete" ? runtime.started_at : undefined;
	const observed = callsOf(jsonl).filter((call) =>
		(!from || Date.parse(call.at) >= Date.parse(from)) &&
		(!from || Date.parse(call.at) <= Date.parse(runtime.finished_at)));
	for (const call of observed) {
		const tool = totals.by_tool[call.tool] ??= { calls: 0, failed: 0 };
		const agent = totals.by_agent[call.agent] ??= { calls: 0, failed: 0 };
		for (const counts of [totals, tool, agent]) {
			counts.calls++;
			if (!call.ok) counts.failed++;
		}
	}
	if (runtime.running_periods && runtime.started_at) {
		const moments = [Date.parse(runtime.started_at), ...observed.map((call) => Date.parse(call.at)).sort((a, b) => a - b), Date.parse(runtime.finished_at)];
		totals.silence_threshold_ms = STALL_MS;
		totals.activity_gaps = moments.slice(1).flatMap((to, index) => {
			const from = moments[index];
			const running = runtime.running_periods!.reduce((sum, period) => sum + Math.max(0,
				Math.min(to, Date.parse(period.finished_at)) - Math.max(from, Date.parse(period.started_at))), 0);
			return running >= STALL_MS ? [{ from: new Date(from).toISOString(), to: new Date(to).toISOString(), running_ms: running }] : [];
		});
	}
	return totals;
}

export function activityOf(jsonl: string | undefined): Activity | undefined {
	const calls = callsOf(jsonl);
	if (!calls.length) return undefined;
	const streaks = new Map<string, Streak>();
	for (const call of calls) {
		const current = streaks.get(call.agent);
		streaks.set(call.agent, { length: call.ok ? 0 : (current?.length ?? 0) + 1 });
	}
	const longest = [...streaks.values()].reduce((a, b) => (b.length > a.length ? b : a));
	const last = calls[calls.length - 1];
	return {
		started: calls[0].at,
		last: last.at,
		calls: calls.length,
		lastTool: last.tool,
		streak: longest.length,
	};
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
