import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryMiB } from "./heap.ts";

test("memory string parsing", () => {
	assert.equal(memoryMiB("4096m"), 4096);
	assert.equal(memoryMiB("8g"), 8192);
	assert.throws(() => memoryMiB("lots"), /8g or 4096m/);
});
