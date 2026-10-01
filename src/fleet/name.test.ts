import assert from "node:assert/strict";
import { test } from "node:test";
import { agentName, sandboxName, slug } from "./name.ts";

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

test("agent name is the sandbox name, fitted to herdr's 32 chars", () => {
	assert.equal(agentName("pi-webapp-web-1589"), "pi-webapp-web-1589");
	const a = agentName("pi-webapp-frontend-ticket-123-fix-login-page-a");
	const b = agentName("pi-webapp-frontend-ticket-123-fix-login-page-b");
	assert.ok(a.length <= 32 && b.length <= 32);
	assert.notEqual(a, b, "two long labels never share an agent name");
	assert.match(a, /^pi-webapp-frontend-/);
	assert.equal(sandboxName("/x/" + "p".repeat(80), "l", "pi-").length, 63);
});

test("pi and claude never share an agent name for one label", () => {
	const names = (label: string) => ["pi-", "claude-"].map((prefix) => agentName(sandboxName("/w/webapp", label, prefix)));
	const short = names("web-1716-1718");
	const long = names("frontend-ticket-123-fix-login-page");

	assert.deepEqual(short, ["pi-webapp-web-1716-1718", "claude-webapp-web-1716-1718"]);
	assert.equal(new Set(long).size, 2);
	assert.ok(long.every((name) => name.length <= 32));
});

test("slug keeps underscores and digits", () => {
	assert.equal(slug("a_b 9"), "a_b-9");
});
