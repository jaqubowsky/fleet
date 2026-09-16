import assert from "node:assert/strict";
import { test } from "node:test";
import { flags } from "./cli.ts";

test("flags: values, bare booleans, -- passthrough", () => {
	assert.deepEqual(flags(["x", "--repo", "/r", "--sign", "--", "npm", "--version"]), { opts: { repo: "/r", sign: true }, rest: ["x", "npm", "--version"] });
});

test("a value flag without a value is an error, never true", () => {
	assert.throws(() => flags(["x", "--branch"]), /missing value for --branch/);
	assert.throws(() => flags(["x", "--branch", "--memory", "8g"]), /missing value for --branch/);
});
