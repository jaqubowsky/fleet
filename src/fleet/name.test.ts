import assert from "node:assert/strict";
import { test } from "node:test";
import { sandboxName, slug } from "./name.ts";

test("sandbox name is pi-<project>-<label>, lowercase, safe", () => {
	assert.equal(sandboxName("/Users/me/Work/webapp", "WEB-1589", "pi-"), "pi-webapp-web-1589");
	assert.equal(sandboxName("/x/My Repo", "fix: iban alert", "pi-"), "pi-my-repo-fix-iban-alert");
});

test("a cut sandbox name never ends on a dash", () => {
	const name = sandboxName("/x/" + "p".repeat(56), "ab-cd", "pi-");

	assert.match(name, /[a-z0-9]$/);
	assert.ok(name.length <= 63);
});

test("label is required", () => {
	assert.throws(() => sandboxName("/x/repo", "  ", "pi-"), /label/);
});

test("slug keeps underscores and digits", () => {
	assert.equal(slug("a_b 9"), "a_b-9");
});
