import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { answer as hook } from "../../claude/hooks/guard.ts";
import { PRIVATE_REPO } from "../profile/fixture.ts";
import { checkout, EMPTY_HOME, here, privateRoot } from "./checkouts.ts";
import { decide, POLICY_TOOLS } from "./policy.ts";

const answer = (input: Parameters<typeof hook>[0], root?: string) =>
	hook(input, root, EMPTY_HOME);

const wrapper = resolve(import.meta.dirname, "../../claude/hooks/guard.sh");

test("the claude hook denies what the policy denies and speaks only for plain read-only commands", () => {
	assert.match(
		answer({
			tool_name: "Bash",
			tool_input: { command: "git push -f origin main" },
		}),
		/"permissionDecision":"deny"/,
	);
	assert.match(
		answer({ tool_name: "Bash", tool_input: { command: "git status" } }),
		/"permissionDecision":"allow"/,
	);
	assert.equal(
		answer({ tool_name: "Bash", tool_input: { command: "npm test" } }),
		"",
	);
});

test("the claude hook leaves a tool its policy was never written for to Claude Code", () => {
	assert.equal(
		answer({ tool_name: "TaskStop", tool_input: { task_id: "b7x2k" } }),
		"",
	);
	assert.match(
		answer({
			tool_name: "mcp__linear__create_issue",
			tool_input: {
				description: "token dump ghp_AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH",
			},
		}),
		/"permissionDecision":"deny"/,
	);
});

test("the wrapper answers through node and refuses when the policy cannot run", () => {
	const ok = spawnSync(wrapper, {
		input: JSON.stringify({
			tool_name: "Read",
			tool_input: { file_path: "~/.ssh/config" },
		}),
		encoding: "utf8",
	});
	assert.equal(ok.status, 0);
	assert.match(ok.stdout, /"permissionDecision":"deny"/);

	const broken = spawnSync(wrapper, { input: "not json", encoding: "utf8" });
	assert.equal(broken.status, 2);
	assert.match(broken.stderr, /refused/);
});

test("the managed matcher sends the hook every tool the policy reads, and only those", () => {
	const tool = readFileSync(
		resolve(import.meta.dirname, "../../claude/tools/align-settings.py"),
		"utf8",
	);
	const matcher = /^HOOK_MATCHER = "([^"]+)"$/m.exec(tool)?.[1] ?? "";

	assert.deepEqual(matcher.split("|").sort(), [...POLICY_TOOLS].sort());
});

test("a heredoc body is text unless it feeds an interpreter", () => {
	const heredoc = (head: string, body: string) =>
		`${head} <<'EOF'\n${body}\nEOF`;

	assert.equal(
		decide(
			"Bash",
			{ command: heredoc("cat > doc.md", "restore ~/.ssh/config here") },
			here,
		).decision,
		"allow",
	);
	assert.equal(
		decide(
			"Bash",
			{ command: heredoc("cat > d.md", "see ~/.config/op/plugins.sh") },
			here,
		).decision,
		"allow",
	);
	assert.equal(
		decide("Bash", { command: heredoc("bash", "cat ~/.ssh/id_ed25519") }, here)
			.decision,
		"deny",
	);
	assert.equal(
		decide(
			"Bash",
			{ command: `cat ~/.ssh/config && ${heredoc("cat > d.md", "x")}` },
			here,
		).decision,
		"deny",
	);
});

test("the claude hook judges a pull request by the profile of the session's working directory", () => {
	const root = privateRoot();
	const create = { command: "gh pr create --fill" };

	const own = answer(
		{
			tool_name: "Bash",
			tool_input: create,
			cwd: checkout(`git@github.com:${PRIVATE_REPO}.git`),
		},
		root,
	);
	const work = answer(
		{
			tool_name: "Bash",
			tool_input: create,
			cwd: checkout("git@github.com:acme/webapp.git"),
		},
		root,
	);

	assert.match(own, /"permissionDecision":"allow"/);
	assert.match(work, /"permissionDecision":"deny"/);
});

test("the claude hook runs a push or pull request the profile grants at auto without asking, and leaves the rest to Claude", () => {
	const root = privateRoot();
	const own = checkout(`git@github.com:${PRIVATE_REPO}.git`);
	const work = checkout("git@github.com:acme/webapp.git");
	const ask = (command: string, cwd: string) =>
		answer({ tool_name: "Bash", tool_input: { command }, cwd }, root);

	for (const command of [
		"git push",
		"git push -u origin feat/login",
		"gh pr create --fill",
		"gh pr merge 12 --squash",
	])
		assert.match(ask(command, own), /"permissionDecision":"allow"/, command);
	assert.equal(ask("git push", work), "");
	assert.equal(ask("git -C ../other push", own), "");
	for (const command of [
		"git push origin +main",
		"git push -uf origin main",
		"git push -d origin main",
		"git push origin \\:main",
		'git push --f""orce origin main',
		"git push --prune origin main",
		"git push --del origin main",
	])
		assert.match(ask(command, own), /"permissionDecision":"deny"/, command);
	for (const command of [
		"git push --receive-pack=true /tmp/bare",
		"git push https://github.com/acme/webapp main",
		"git push fork main",
	])
		assert.equal(ask(command, own), "", command);
});

test("the claude hook refuses an edit or a shell write of the host's permissions and leaves reading them to Claude", () => {
	const root = privateRoot();
	const ask = (tool_name: string, tool_input: Record<string, unknown>) =>
		answer({ tool_name, tool_input, cwd: root }, root);

	assert.match(
		ask("Edit", { file_path: "host/repos.json" }),
		/"permissionDecision":"deny"/,
	);
	for (const tool of ["Edit", "Write"])
		assert.match(
			ask(tool, { file_path: "~/.config/harness/repos.json" }),
			/"permissionDecision":"deny"/,
			tool,
		);
	assert.match(
		ask("Bash", { command: "echo '{}' | tee host/repos.json" }),
		/"permissionDecision":"deny"/,
	);
	assert.equal(ask("Read", { file_path: "host/repos.json" }), "");
});

test("the claude hook refuses a privileged command that is not bare on one line, so the sandbox exclusion matches it", () => {
	const root = privateRoot();
	const own = checkout(`git@github.com:${PRIVATE_REPO}.git`);
	const ask = (command: string) =>
		answer({ tool_name: "Bash", tool_input: { command }, cwd: own }, root);

	for (const command of [
		"npm test && git push",
		"cd .. ; fleet up demo",
		"fleet land\ngit status",
		"gh pr create --title t --body 'first\nsecond'",
		"git fetch origin && git log origin/main",
		"gh run view 7 --log-failed | tail",
		"(git push)",
	])
		assert.match(ask(command), /bare, on one line/, command);
	assert.match(
		ask("gh pr create --title 'a | b' --body 'c; d'"),
		/"permissionDecision":"allow"/,
	);
	for (const command of [
		'gh pr view 12 --json title --jq ".title | length"',
		"gh run list --commit abc",
		"echo 'git push' | wc -c",
	])
		assert.equal(ask(command), "", command);
});

test("the claude hook refuses every sandbox exclusion that is not bare, and names each one", () => {
	const root = privateRoot();
	const own = checkout(`git@github.com:${PRIVATE_REPO}.git`);
	const ask = (command: string) =>
		answer({ tool_name: "Bash", tool_input: { command }, cwd: own }, root);
	const excluded: string[] = JSON.parse(
		readFileSync(
			resolve(import.meta.dirname, "../../claude/managed-settings.json"),
			"utf8",
		),
	).sandbox.excludedCommands;
	const reads = ["gh pr view", "gh pr checks", "gh pr list", "gh run list"];

	const refusal = ask("true && git push");
	for (const command of excluded
		.map((pattern) => pattern.replace(/\*$/, ""))
		.filter((command) => !reads.includes(command))) {
		assert.match(ask(`${command}\n`), /bare, on one line/, command);
		assert.ok(refusal.includes(command), command);
	}
	for (const command of reads)
		assert.equal(ask(`${command} | head`), "", command);
	assert.match(ask('git add -A && git commit -m "fix"'), /bare, on one line/);
});

test("the claude hook follows the target sandbox's down level and asks in auto permission mode", () => {
	const root = privateRoot();
	const command = {
		tool_name: "Bash",
		tool_input: { command: "fleet down pi-harness-demo" },
		cwd: root,
	};
	const ask = (level: "auto" | "human" | "none") =>
		hook(command, root, EMPTY_HOME, () => ({
			sandbox: "pi-harness-demo",
			level,
		}));

	assert.match(ask("auto"), /"permissionDecision":"allow"/);
	assert.match(ask("human"), /"permissionDecision":"ask"/);
	assert.match(ask("human"), /pi-harness-demo/);
	assert.match(ask("none"), /"permissionDecision":"deny"/);
	assert.match(
		hook(command, root, EMPTY_HOME, () => undefined),
		/"permissionDecision":"deny"/,
	);
	assert.match(
		hook(
			{ ...command, tool_input: { command: "fleet down pi-harness-demo | tail" } },
			root,
			EMPTY_HOME,
			() => ({ sandbox: "pi-harness-demo", level: "auto" }),
		),
		/"permissionDecision":"deny"/,
	);
});

test("the claude hook lets a GitHub read run in any shell form, since the sandbox reaches GitHub, and keeps writes bare", () => {
	const root = privateRoot();
	const own = checkout(`git@github.com:${PRIVATE_REPO}.git`);
	const ask = (command: string) =>
		answer({ tool_name: "Bash", tool_input: { command }, cwd: own }, root);

	for (const command of [
		"gh pr view 12 | head",
		"gh pr diff 12 | grep -c '^+'",
		"gh pr checks 12 > checks.txt",
		"gh pr list 2>&1",
		"gh run list --commit abc > runs.txt",
		"for n in 12 13; do gh pr view $n --json title; done",
	])
		assert.equal(ask(command), "", command);
	for (const command of [
		"gh pr merge 12 --merge | cat",
		"gh pr view 12 && gh pr merge 12 --merge",
		"for n in 12 13; do gh pr merge $n --merge; done",
		"if true; then gh pr create --fill; fi",
		"echo 12 | xargs gh pr merge",
		"/opt/homebrew/bin/gh pr create --fill",
		"env gh pr merge 12 --merge",
		"command gh pr merge 12",
	])
		assert.match(ask(command), /"permissionDecision":"deny"/, command);
});
