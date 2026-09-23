type Cost = { total?: number };
type Usage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; reasoning?: number; cost?: Cost };
type ToolCall = { type: string; name?: string; arguments?: { path?: string } };
type Entry = {
	type: string;
	timestamp?: string;
	modelId?: string;
	kind?: string;
	usage?: Usage;
	message?: { role: string; model?: string; usage?: Usage; content?: ToolCall[] | string };
};

export type Commit = { sha: string; at: string };

export type Run = {
	skill: string;
	model: string;
	started_at: string;
	finished_at: string;
	requests: number;
	input: number;
	cached_input: number;
	cache_write: number;
	output: number;
	reasoning: number;
	cost: number;
	compactions: number;
	commits: string[];
};

export type Summary = {
	runs: Run[];
	totals: Pick<Run, "requests" | "input" | "cached_input" | "cache_write" | "output" | "reasoning" | "cost" | "compactions">;
	cache_hit_ratio: number;
	cache_misses: number;
	cache_warm_cost: number;
	model_changes: number;
};

const SKILL_FILE = /\/skills\/([^/]+)\/SKILL\.md$/;
const DIRECT = "direct";

type ClaudeUsage = {
	input_tokens?: number;
	output_tokens?: number;
	cache_read_input_tokens?: number;
	cache_creation_input_tokens?: number;
	cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};

const CLAUDE_USD_PER_MTOK: Record<string, { input: number; output: number; cacheRead: number }> = {
	"claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
	"claude-fable-5": { input: 10, output: 50, cacheRead: 1 },
	"claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
	"claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
	"claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
	"claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

export function claudeCost(model: string | undefined, usage: ClaudeUsage): number {
	const price = CLAUDE_USD_PER_MTOK[(model ?? "").replace(/\[.*\]$/, "")];
	if (!price) return 0;
	const written = usage.cache_creation_input_tokens ?? 0;
	const hour = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
	const tokens =
		(usage.input_tokens ?? 0) * price.input +
		(usage.output_tokens ?? 0) * price.output +
		(usage.cache_read_input_tokens ?? 0) * price.cacheRead +
		(written - hour) * price.input * 1.25 +
		hour * price.input * 2;
	return tokens / 1_000_000;
}
type ClaudePart = { type: string; name?: string; input?: { file_path?: string; skill?: string } };
type ClaudeLine = { type: string; subtype?: string; timestamp?: string; message?: { id?: string; role?: string; model?: string; usage?: ClaudeUsage; content?: ClaudePart[] | string } };

function claudeCalls(content: ClaudePart[] | string | undefined): ToolCall[] {
	if (!Array.isArray(content)) return [];
	return content.flatMap((part): ToolCall[] => {
		if (part.type !== "tool_use") return [];
		if (part.name === "Skill" && part.input?.skill) return [{ type: "toolCall", name: "read", arguments: { path: `/skills/${part.input.skill}/SKILL.md` } }];
		if (part.name === "Read") return [{ type: "toolCall", name: "read", arguments: { path: part.input?.file_path } }];
		return [];
	});
}

function fromClaude(line: ClaudeLine, seen: Set<string>): Entry[] {
	if (line.type === "system" && line.subtype === "compact_boundary") return [{ type: "compaction" }];
	const usage = line.message?.usage;
	if (line.type !== "assistant" || !usage) return [];
	const id = line.message?.id;
	if (id && seen.has(id)) return [];
	if (id) seen.add(id);
	return [
		{
			type: "message",
			timestamp: line.timestamp,
			message: {
				role: "assistant",
				model: line.message?.model,
				usage: { input: usage.input_tokens, output: usage.output_tokens, cacheRead: usage.cache_read_input_tokens, cacheWrite: usage.cache_creation_input_tokens, cost: { total: claudeCost(line.message?.model, usage) } },
				content: claudeCalls(line.message?.content),
			},
		},
	];
}

export function parseEntries(jsonl: string): Entry[] {
	const seen = new Set<string>();
	return jsonl
		.split("\n")
		.filter((line) => line.trim())
		.flatMap((line) => {
			let parsed: Entry & ClaudeLine;
			try {
				parsed = JSON.parse(line);
			} catch {
				return [];
			}
			return parsed.type === "assistant" || parsed.type === "system" ? fromClaude(parsed, seen) : [parsed as Entry];
		});
}

function skillRead(content: ToolCall[] | string | undefined): string | undefined {
	if (!Array.isArray(content)) return undefined;
	for (const part of content) {
		if (part.type !== "toolCall" || part.name !== "read") continue;
		const hit = SKILL_FILE.exec(part.arguments?.path ?? "");
		if (hit) return hit[1];
	}
	return undefined;
}

function emptyRun(skill: string, model: string, at: string): Run {
	return { skill, model, started_at: at, finished_at: at, requests: 0, input: 0, cached_input: 0, cache_write: 0, output: 0, reasoning: 0, cost: 0, compactions: 0, commits: [] };
}

export function summarize(entries: Entry[], commits: Commit[] = []): Summary {
	const runs: Run[] = [];
	let skill = DIRECT;
	let model = "";
	let modelChanges = -1;
	let warm = 0;
	let misses = 0;
	const current = () => runs[runs.length - 1];

	for (const entry of entries) {
		if (entry.type === "model_change") {
			model = entry.modelId ?? model;
			modelChanges++;
			continue;
		}
		if (entry.type === "usage" && entry.kind === "cache_warm") {
			warm += entry.usage?.cost?.total ?? 0;
			continue;
		}
		if (entry.type === "compaction") {
			if (current()) current().compactions++;
			continue;
		}
		if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
		const usage = entry.message.usage ?? {};
		const at = entry.timestamp ?? "";
		skill = skillRead(entry.message.content) ?? skill;
		model = entry.message.model ?? model;
		if (!current() || current().skill !== skill || current().model !== model) runs.push(emptyRun(skill, model, at));
		const run = current();
		run.finished_at = at;
		run.requests++;
		run.input += usage.input ?? 0;
		run.cached_input += usage.cacheRead ?? 0;
		run.cache_write += usage.cacheWrite ?? 0;
		run.output += usage.output ?? 0;
		run.reasoning += usage.reasoning ?? 0;
		run.cost += usage.cost?.total ?? 0;
		if (!(usage.cacheRead ?? 0)) misses++;
	}

	for (const commit of commits) {
		const run = runs.find((r) => r.started_at <= commit.at && commit.at <= r.finished_at) ?? runs.find((r) => commit.at < r.started_at);
		(run ?? current())?.commits.push(commit.sha);
	}

	const totals = runs.reduce(
		(sum, r) => ({
			requests: sum.requests + r.requests,
			input: sum.input + r.input,
			cached_input: sum.cached_input + r.cached_input,
			cache_write: sum.cache_write + r.cache_write,
			output: sum.output + r.output,
			reasoning: sum.reasoning + r.reasoning,
			cost: sum.cost + r.cost,
			compactions: sum.compactions + r.compactions,
		}),
		{ requests: 0, input: 0, cached_input: 0, cache_write: 0, output: 0, reasoning: 0, cost: 0, compactions: 0 },
	);
	const seen = totals.input + totals.cached_input;

	return { runs, totals, cache_hit_ratio: seen ? totals.cached_input / seen : 0, cache_misses: misses, cache_warm_cost: warm, model_changes: Math.max(modelChanges, 0) };
}

export function oneLine(summary: Summary): string {
	const t = summary.totals;
	return `${t.requests} requests, ${summary.runs.length} run(s), cache hit ${Math.round(summary.cache_hit_ratio * 100)}% (${summary.cache_misses} miss), ${t.compactions} compaction(s), ${summary.model_changes} model change(s), cost ${t.cost.toFixed(2)}`;
}
