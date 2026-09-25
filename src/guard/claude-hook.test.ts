import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { answer } from "../../claude/hooks/guard.ts";
import { PRIVATE_REPO } from "../profile/fixture.ts";
import { checkout, here, privateRoot } from "./checkouts.ts";
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

	assert.equal(decide("Bash", { command: heredoc("cat > doc.md", "restore ~/.ssh/config here") }, here).decision, "allow");
	assert.equal(decide("Bash", { command: heredoc("cat > d.md", "see ~/.config/op/plugins.sh") }, here).decision, "allow");
	assert.equal(decide("Bash", { command: heredoc("bash", "cat ~/.ssh/id_ed25519") }, here).decision, "deny");
	assert.equal(decide("Bash", { command: `cat ~/.ssh/config && ${heredoc("cat > d.md", "x")}` }, here).decision, "deny");
});

test("the claude hook judges a pull request by the profile of the session's working directory", () => {
	const root = privateRoot();
	const create = { command: "gh pr create --fill" };

	const own = answer({ tool_name: "Bash", tool_input: create, cwd: checkout(`git@github.com:${PRIVATE_REPO}.git`) }, root);
	const work = answer({ tool_name: "Bash", tool_input: create, cwd: checkout("git@github.com:acme/webapp.git") }, root);

	assert.match(own, /"permissionDecision":"allow"/);
	assert.match(work, /"permissionDecision":"deny"/);
});

test("the claude hook runs a push or pull request the profile grants at auto without asking, and leaves the rest to Claude", () => {
	const root = privateRoot();
	const own = checkout(`git@github.com:${PRIVATE_REPO}.git`);
	const work = checkout("git@github.com:acme/webapp.git");
	const ask = (command: string, cwd: string) => answer({ tool_name: "Bash", tool_input: { command }, cwd }, root);

	for (const command of ["git push", "git push -u origin feat/login", "gh pr create --fill", "gh pr merge 12 --squash"]) assert.match(ask(command, own), /"permissionDecision":"allow"/, command);
	assert.equal(ask("git push", work), "");
	assert.equal(ask("npm test && git push", own), "");
	assert.equal(ask("git -C ../other push", own), "");
	for (const command of ["git push origin +main", "git push -uf origin main", "git push -d origin main", "git push origin \\:main", 'git push --f""orce origin main', "git push --prune origin main", "git push --del origin main"]) assert.match(ask(command, own), /"permissionDecision":"deny"/, command);
	for (const command of ["git push --receive-pack=true /tmp/bare", "git push https://github.com/acme/webapp main", "git push fork main"]) assert.equal(ask(command, own), "", command);
});

test("the claude hook refuses an edit or a shell write of the host's permissions and leaves reading them to Claude", () => {
	const root = privateRoot();
	const ask = (tool_name: string, tool_input: Record<string, unknown>) => answer({ tool_name, tool_input, cwd: root }, root);

	assert.match(ask("Edit", { file_path: "host/repos.json" }), /"permissionDecision":"deny"/);
	assert.match(ask("Bash", { command: "echo '{}' | tee host/repos.json" }), /"permissionDecision":"deny"/);
	assert.equal(ask("Read", { file_path: "host/repos.json" }), "");
});
