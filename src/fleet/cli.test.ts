import assert from "node:assert/strict";
import { test } from "node:test";
import { flags } from "./cli.ts";

test("flags: values, bare booleans, -- passthrough", () => {
	assert.deepEqual(flags(["x", "--repo", "/r", "--sign", "--", "npm", "--version"], ["repo", "sign"]), { opts: { repo: "/r", sign: true }, rest: ["x", "npm", "--version"] });
});

test("a value flag without a value is an error, never true", () => {
	assert.throws(() => flags(["x", "--branch"], ["branch"]), /missing value for --branch/);
	assert.throws(() => flags(["x", "--branch", "--memory", "8g"], ["branch", "memory"]), /missing value for --branch/);
});

test("an option the command does not take is refused instead of ignored", () => {
	assert.throws(() => flags(["--help"], []), /unknown option --help/);
	assert.throws(() => flags(["--repo", "/r"], ["lines"]), /unknown option --repo/);
});

test("the usage names the two files init lays out", () => {
	assert.throws(() => flags(["--nope"], []), (error: Error) => {
		const line = error.message.split("\n").find((row) => row.includes(" init <repo>"));
		assert.ok(line, "usage has an init line");
		assert.match(line, /AGENTS\.md, spec\/vision\.md;/);
		assert.doesNotMatch(line, /board|ticket/);
		return true;
	});
});

test("the up usage starts the seat's agent, whichever harness runs it", () => {
	assert.throws(() => flags(["--nope"], []), (error: Error) => {
		const line = error.message.split("\n").find((row) => row.includes(" up <label>"));
		assert.ok(line, "usage has an up line");
		assert.match(line, /start the seat's agent in a herdr tab/);
		assert.doesNotMatch(line, /start pi/);
		return true;
	});
});
