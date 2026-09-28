import assert from "node:assert/strict";
import { test } from "node:test";
import { resetAt } from "./limit.ts";

test("the reset time is the next one the message names, in local time", () => {
	const after = new Date(2026, 8, 16, 21, 40);
	assert.deepEqual(resetAt("limit · resets 11:10pm", after), new Date(2026, 8, 16, 23, 10));
	assert.deepEqual(resetAt("resets 9pm", after), new Date(2026, 8, 17, 21, 0));
	assert.deepEqual(resetAt("resets 12:30am", after), new Date(2026, 8, 17, 0, 30));
	assert.equal(resetAt("API Error: rate_limit", after), undefined);
});
