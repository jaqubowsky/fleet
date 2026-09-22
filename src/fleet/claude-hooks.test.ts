import assert from "node:assert/strict";
import { test } from "node:test";
import { contextTokens, HANDOFF, handoffNote } from "../../claude/hooks/container.ts";

const turn = (input: number, cached: number) => JSON.stringify({ type: "assistant", message: { usage: { input_tokens: input, cache_read_input_tokens: cached, cache_creation_input_tokens: 0 } } });

test("the context is what the last answer carried, not the sum of the session", () => {
	const transcript = [turn(100, 1000), JSON.stringify({ type: "user" }), turn(200, 260000), "not json"].join("\n");

	assert.equal(contextTokens(transcript), 260200);
	assert.equal(contextTokens(""), 0);
});

test("a context past the threshold asks the host for a handoff once, and never over a person's attention line", () => {
	const status = "status: implementing\nattention: none\n\n## Summary\nx\n";

	assert.equal(handoffNote(status, 249_999, 250_000), undefined);
	assert.equal(handoffNote(status, 250_000, 250_000), status.replace("attention: none", HANDOFF));
	assert.equal(handoffNote(status.replace("attention: none", "attention: pick a date format"), 300_000, 250_000), undefined);
});
