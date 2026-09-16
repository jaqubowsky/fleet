import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAgents, expandIncludes } from "./agents.ts";

test("rules concatenate in order with one blank line between", () => {
	const out = buildAgents([{ name: "core.md", body: "# Core\n1. a\n" }, { name: "env.md", body: "# Env\n" }], [], () => undefined);
	assert.equal(out, "# Core\n1. a\n\n# Env\n");
});

test("excluded files are skipped", () => {
	const out = buildAgents([{ name: "core.md", body: "# Core" }, { name: "env.md", body: "# Env" }], ["env.md"], () => undefined);
	assert.equal(out, "# Core\n");
});

test("@/absolute lines inline the file and fail when missing", () => {
	assert.equal(expandIncludes("a\n@/x/index.md\nb", (p) => (p === "/x/index.md" ? "INDEX\n" : undefined)), "a\nINDEX\nb");
	assert.throws(() => expandIncludes("@/nope.md", () => undefined), /include not found/);
});
