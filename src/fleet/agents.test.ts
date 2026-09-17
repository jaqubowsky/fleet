import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAgents } from "./agents.ts";

test("rules concatenate in order with one blank line between", () => {
	const out = buildAgents([{ name: "core.md", body: "# Core\n1. a\n" }, { name: "env.md", body: "# Env\n" }], []);
	assert.equal(out, "# Core\n1. a\n\n# Env\n");
});

test("excluded files are skipped", () => {
	const out = buildAgents([{ name: "core.md", body: "# Core" }, { name: "env.md", body: "# Env" }], ["env.md"]);
	assert.equal(out, "# Core\n");
});
