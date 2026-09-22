import assert from "node:assert/strict";
import { test } from "node:test";
import { agentName, sandboxName, slug } from "./name.ts";

test("sandbox name is pi-<project>-<label>, lowercase, safe", () => {
	assert.equal(sandboxName("/Users/me/Work/webapp", "WEB-1589", "pi-"), "pi-webapp-web-1589");
	assert.equal(sandboxName("/x/My Repo", "fix: iban alert", "pi-"), "pi-my-repo-fix-iban-alert");
});

test("label is required", () => {
	assert.throws(() => sandboxName("/x/repo", "  ", "pi-"), /label/);
});

test("agent name drops the pi- prefix and fits herdr's 32 chars", () => {
	assert.equal(agentName("pi-webapp-web-1589"), "webapp-web-1589");
	const a = agentName("pi-webapp-frontend-ticket-123-fix-login-page-a");
	const b = agentName("pi-webapp-frontend-ticket-123-fix-login-page-b");
	assert.ok(a.length <= 32 && b.length <= 32);
	assert.notEqual(a, b, "two long labels never share an agent name");
	assert.match(a, /^webapp-frontend-ticket-/);
	assert.equal(sandboxName("/x/" + "p".repeat(80), "l", "pi-").length, 63);
});

test("slug keeps underscores and digits", () => {
	assert.equal(slug("a_b 9"), "a_b-9");
});
