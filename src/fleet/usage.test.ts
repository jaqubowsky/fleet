import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeSessions, oneLine, parseEntries, summarize } from "./usage.ts";

const request = (at: string, usage: Record<string, number>, calls: string[] = [], model = "gpt-5.6-sol") =>
	JSON.stringify({
		type: "message",
		timestamp: at,
		message: {
			role: "assistant",
			model,
			usage: { input: usage.input, output: usage.output ?? 0, cacheRead: usage.cacheRead ?? 0, cacheWrite: 0, reasoning: usage.reasoning ?? 0, cost: { total: usage.cost ?? 0 } },
			content: calls.map((path) => ({ type: "toolCall", name: "read", arguments: { path } })),
		},
	});

const session = [
	JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-09-21T12:01:18Z" }),
	JSON.stringify({ type: "model_change", timestamp: "2026-09-21T12:01:37Z", provider: "openai-codex", modelId: "gpt-5.6-sol" }),
	JSON.stringify({ type: "message", timestamp: "2026-09-21T12:01:43Z", message: { role: "user", content: [{ type: "text", text: "Przeanalizuj WEB-1" }] } }),
	request("2026-09-21T12:02:02Z", { input: 19954, output: 343, cacheRead: 0, reasoning: 310, cost: 0.0044 }, ["/home/agent/.pi/skills/analyze-task/SKILL.md"]),
	request("2026-09-21T12:02:16Z", { input: 3252, output: 259, cacheRead: 18944, reasoning: 93, cost: 0.0013 }),
	JSON.stringify({ type: "usage", timestamp: "2026-09-21T12:05:00Z", kind: "cache_warm", usage: { cost: { total: 0.015 } } }),
	request("2026-09-21T12:10:00Z", { input: 1749, output: 125, cacheRead: 22016, reasoning: 90, cost: 0.0009 }, ["/home/agent/.pi/skills/implement/SKILL.md"]),
	JSON.stringify({ type: "compaction", timestamp: "2026-09-21T12:20:00Z", summary: "...", firstKeptEntryId: "x", tokensBefore: 50000 }),
	request("2026-09-21T12:21:00Z", { input: 30000, output: 500, cacheRead: 0, cost: 0.02 }),
	JSON.stringify({ type: "model_change", timestamp: "2026-09-21T12:30:00Z", provider: "openai-codex", modelId: "gpt-6-astra" }),
	request("2026-09-21T12:31:00Z", { input: 40000, output: 700, cacheRead: 0, cost: 0.9 }, [], "gpt-6-astra"),
].join("\n");

test("usage splits a session into runs at each skill read and each model change", () => {
	const summary = summarize(parseEntries(session));

	assert.deepEqual(
		summary.runs.map((r) => [r.skill, r.model, r.requests, r.compactions]),
		[
			["analyze-task", "gpt-5.6-sol", 2, 0],
			["implement", "gpt-5.6-sol", 2, 1],
			["implement", "gpt-6-astra", 1, 0],
		],
	);
	assert.equal(summary.runs[0].started_at, "2026-09-21T12:02:02Z");
	assert.equal(summary.runs[0].finished_at, "2026-09-21T12:02:16Z");
	assert.equal(summary.runs[0].input, 23206);
	assert.equal(summary.runs[0].cached_input, 18944);
	assert.equal(summary.runs[0].reasoning, 403);
});

test("a new order files its cost as direct until it reads a skill of its own", () => {
	const later = [
		session,
		JSON.stringify({ type: "message", timestamp: "2026-09-21T12:40:00Z", message: { role: "user", content: [{ type: "text", text: "Zrób rebase" }] } }),
		request("2026-09-21T12:41:00Z", { input: 1000, cacheRead: 40000, cost: 0.01 }, [], "gpt-6-astra"),
	].join("\n");

	assert.deepEqual(summarize(parseEntries(later)).runs.at(-1)?.skill, "direct");
});

test("usage totals the session and counts what breaks the cache", () => {
	const summary = summarize(parseEntries(session));

	assert.equal(summary.totals.requests, 5);
	assert.equal(summary.totals.input, 94955);
	assert.equal(summary.totals.cached_input, 40960);
	assert.equal(summary.cache_misses, 3);
	assert.equal(summary.totals.compactions, 1);
	assert.equal(summary.model_changes, 1);
	assert.equal(summary.cache_warm_cost, 0.015);
	assert.ok(Math.abs(summary.totals.cost - 0.9266) < 1e-9);
	assert.equal(Math.round(summary.cache_hit_ratio * 100), 30);
	assert.equal(oneLine(summary), "5 requests, 3 run(s), cache hit 30% (3 miss), 1 compaction(s), 1 model change(s), cost 0.93");
});

test("usage assigns commits to the run that was live when they were made", () => {
	const summary = summarize(parseEntries(session), [
		{ sha: "aaa1111", at: "2026-09-21T12:15:00Z" },
		{ sha: "bbb2222", at: "2026-09-21T12:40:00Z" },
	]);

	assert.deepEqual(summary.runs.map((r) => r.commits), [[], ["aaa1111"], ["bbb2222"]]);
});

test("a Claude transcript is priced from its tokens", () => {
	const turn = (id: string, model: string, usage: object) => JSON.stringify({ type: "assistant", timestamp: "2026-09-23T12:00:00Z", message: { id, role: "assistant", model, usage, content: [] } });
	const transcript = [
		turn("a", "claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 500_000, ephemeral_1h_input_tokens: 500_000 } }),
		turn("b", "claude-sonnet-5", { input_tokens: 1_000_000, output_tokens: 0 }),
		turn("c", "claude-unpriced-9", { input_tokens: 1_000_000 }),
	].join("\n");

	const summary = summarize(parseEntries(transcript));

	assert.ok(Math.abs(summary.totals.cost - (4 + 2 + 0.2 + 2.5 + 4 + 2)) < 1e-9, String(summary.totals.cost));
});

test("an advisor's answer inside a Claude turn is priced at the advisor's model", () => {
	const transcript = JSON.stringify({
		type: "assistant",
		timestamp: "2026-09-23T12:00:00Z",
		message: {
			id: "a",
			role: "assistant",
			model: "claude-sonnet-5-5",
			usage: {
				input_tokens: 1_000_000,
				output_tokens: 0,
				iterations: [
					{ type: "message", input_tokens: 1_000_000, output_tokens: 0 },
					{ type: "advisor_message", model: "claude-opus-5-5", input_tokens: 1_000_000, output_tokens: 100_000 },
				],
			},
			content: [],
		},
	});

	const summary = summarize(parseEntries(transcript));

	assert.ok(Math.abs(summary.totals.cost - (2 + 4 + 2)) < 1e-9, String(summary.totals.cost));
});

test("usage survives an empty or broken transcript", () => {
	assert.deepEqual(summarize(parseEntries("")).runs, []);
	assert.deepEqual(summarize(parseEntries("{not json\n")).runs, []);
	assert.equal(summarize(parseEntries("")).cache_hit_ratio, 0);
});

const claudeTurn = (id: string, at: string, skill?: string) =>
	JSON.stringify({
		type: "assistant",
		timestamp: at,
		message: {
			id,
			role: "assistant",
			model: "claude-opus-5-5",
			usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 9000 },
			content: skill ? [{ type: "tool_use", name: "Skill", input: { skill } }] : [],
		},
	});

const mainSession = [
	claudeTurn("m1", "2026-10-30T10:00:00.000Z"),
	claudeTurn("m2", "2026-10-30T10:20:00.000Z", "babysit-pr"),
	claudeTurn("m3", "2026-10-30T10:30:00.000Z"),
].join("\n");

const subAgent = [claudeTurn("s1", "2026-10-30T10:05:00.000Z"), claudeTurn("s2", "2026-10-30T10:15:00.000Z")].join("\n");

const overlapping = (...files: string[]) => {
	const seen = new Set<string>();
	return mergeSessions(files.map((file) => parseEntries(file, seen)));
};

test("runs of overlapping session files follow time and never end before they start", () => {
	const summary = summarize(overlapping(mainSession, subAgent));

	assert.deepEqual(
		summary.runs.map((r) => [r.skill, r.started_at, r.finished_at, r.requests]),
		[
			["direct", "2026-10-30T10:00:00.000Z", "2026-10-30T10:00:00.000Z", 1],
			["direct", "2026-10-30T10:05:00.000Z", "2026-10-30T10:15:00.000Z", 2],
			["babysit-pr", "2026-10-30T10:20:00.000Z", "2026-10-30T10:30:00.000Z", 2],
		],
	);
});

test("a skill read in one session file labels only that file", () => {
	const reviewer = [claudeTurn("r1", "2026-10-30T10:22:00.000Z", "two-axis-review"), claudeTurn("r2", "2026-10-30T10:25:00.000Z")].join("\n");

	const summary = summarize(overlapping(mainSession, subAgent, reviewer));

	assert.deepEqual(
		summary.runs.map((r) => [r.skill, r.requests]),
		[
			["direct", 1],
			["direct", 2],
			["babysit-pr", 2],
			["two-axis-review", 2],
		],
	);
});

test("merging session files keeps the totals and puts commits in the run live at the time", () => {
	const summary = summarize(overlapping(mainSession, subAgent), [{ sha: "ccc3333", at: "2026-10-30T10:25:00.000Z" }]);

	assert.equal(summary.totals.requests, 5);
	assert.equal(summary.totals.input, 5000);
	assert.equal(summary.totals.cached_input, 45000);
	assert.equal(summary.totals.output, 500);
	assert.ok(Math.abs(summary.totals.cost - 5 * (1000 * 4 + 100 * 20 + 9000 * 0.2) / 1_000_000) < 1e-9);
	assert.deepEqual(summary.runs.map((r) => r.commits), [[], [], ["ccc3333"]]);
});

test("pi compactions count once each when a later session file compacts before it answers", () => {
	const resumed = [
		JSON.stringify({ type: "session", version: 3, id: "s2", timestamp: "2026-09-21T13:00:00Z" }),
		JSON.stringify({ type: "compaction", timestamp: "2026-09-21T13:00:05Z", summary: "...", firstKeptEntryId: "y", tokensBefore: 60000 }),
		request("2026-09-21T13:01:00Z", { input: 500, cacheRead: 30000, cost: 0.01 }, [], "gpt-6-astra"),
	].join("\n");

	const summary = summarize(overlapping(session, resumed));

	assert.equal(summary.totals.compactions, 2);
	assert.equal(summary.totals.requests, 6);
	assert.equal(summary.model_changes, 1);
});

test("a resumed session file that repeats a skill read keeps that skill for its new turns", () => {
	const first = claudeTurn("a", "2026-10-30T10:00:00.000Z", "babysit-pr");
	const resumed = [claudeTurn("a", "2026-10-30T10:00:00.000Z", "babysit-pr"), claudeTurn("b", "2026-10-30T10:30:00.000Z")].join("\n");

	const summary = summarize(overlapping(first, resumed));

	assert.deepEqual(summary.runs.map((r) => [r.skill, r.requests]), [["babysit-pr", 1], ["babysit-pr", 1]]);
	assert.equal(summary.totals.requests, 2);
});

test("a skill read on a later line of one Claude message labels the turns after it", () => {
	const thinking = JSON.stringify({ type: "assistant", timestamp: "2026-10-30T10:00:00.000Z", message: { id: "m", role: "assistant", model: "claude-opus-5-5", usage: { input_tokens: 1000 }, content: [{ type: "thinking" }] } });
	const call = claudeTurn("m", "2026-10-30T10:00:01.000Z", "deliver-ticket");

	const summary = summarize(overlapping([thinking, call, claudeTurn("n", "2026-10-30T10:01:00.000Z")].join("\n")));

	assert.deepEqual(summary.runs.map((r) => [r.skill, r.requests]), [["direct", 1], ["deliver-ticket", 1]]);
});
