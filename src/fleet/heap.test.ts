import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryMiB, nodeHeapMiB } from "./heap.ts";

test("8g gives a 3 GiB heap", () => {
	assert.equal(nodeHeapMiB("8g"), 3072);
});

test("4g keeps 2 GiB for the rest of the container", () => {
	assert.equal(nodeHeapMiB("4g"), 1536);
});

test("3g is capped by the reserve", () => {
	assert.equal(nodeHeapMiB("3g"), 1024);
});

test("too little memory fails", () => {
	assert.throws(() => nodeHeapMiB("2g"), /must exceed/);
});

test("memory string parsing", () => {
	assert.equal(memoryMiB("4096m"), 4096);
	assert.throws(() => memoryMiB("lots"), /8g or 4096m/);
});
