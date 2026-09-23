import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { answer } from "../../claude/hooks/guard.ts";
import { decide, POLICY_TOOLS } from "./policy.ts";

const wrapper = resolve(import.meta.dirname, "../../claude/hooks/guard.sh");

test("the claude hook denies what the policy denies and speaks only for plain read-only commands", () => {
	assert.match(answer({ tool_name: "Bash", tool_input: { command: "git push -f origin main" } }), /"permissionDecision":"deny"/);
	assert.match(answer({ tool_name: "Bash", tool_input: { command: "git status" } }), /"permissionDecision":"allow"/);
	assert.equal(answer({ tool_name: "Bash", tool_input: { command: "npm test" } }), "");
});

test("the claude hook leaves a tool its policy was never written for to Claude Code", () => {
	assert.equal(answer({ tool_name: "TaskStop", tool_input: { task_id: "b7x2k" } }), "");
	assert.match(answer({ tool_name: "mcp__linear__create_issue", tool_input: { description: "token dump ghp_AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH" } }), /"permissionDecision":"deny"/);
});

test("the wrapper answers through node and refuses when the policy cannot run", () => {
	const ok = spawnSync(wrapper, { input: JSON.stringify({ tool_name: "Read", tool_input: { file_path: "~/.ssh/config" } }), encoding: "utf8" });
	assert.equal(ok.status, 0);
	assert.match(ok.stdout, /"permissionDecision":"deny"/);

	const broken = spawnSync(wrapper, { input: "not json", encoding: "utf8" });
	assert.equal(broken.status, 2);
	assert.match(broken.stderr, /refused/);
});

test("the managed matcher sends the hook every tool the policy reads, and only those", () => {
	const tool = readFileSync(resolve(import.meta.dirname, "../../claude/tools/align-settings.py"), "utf8");
	const matcher = /^HOOK_MATCHER = "([^"]+)"$/m.exec(tool)?.[1] ?? "";

	assert.deepEqual(matcher.split("|").sort(), [...POLICY_TOOLS].sort());
});

test("a heredoc body is text unless it feeds an interpreter", () => {
	const heredoc = (head: string, body: string) => `${head} <<'EOF'\n${body}\nEOF`;

	assert.equal(decide("Bash", { command: heredoc("cat > doc.md", "restore ~/.ssh/config here") }).decision, "allow");
	assert.equal(decide("Bash", { command: heredoc("cat > d.md", "see ~/.config/op/plugins.sh") }).decision, "allow");
	assert.equal(decide("Bash", { command: heredoc("bash", "cat ~/.ssh/id_ed25519") }).decision, "deny");
	assert.equal(decide("Bash", { command: `cat ~/.ssh/config && ${heredoc("cat > d.md", "x")}` }).decision, "deny");
});
