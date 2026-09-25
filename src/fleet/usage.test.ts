import assert from "node:assert/strict";
import { test } from "node:test";
import { oneLine, parseEntries, summarize } from "./usage.ts";

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

test("usage survives an empty or broken transcript", () => {
	assert.deepEqual(summarize(parseEntries("")).runs, []);
	assert.deepEqual(summarize(parseEntries("{not json\n")).runs, []);
	assert.equal(summarize(parseEntries("")).cache_hit_ratio, 0);
});
