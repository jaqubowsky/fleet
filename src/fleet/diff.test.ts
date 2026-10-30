import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DIFF_PROBE, containerPatch } from "./diff.ts";
import { fakeIo } from "./fake-io.ts";

const RUNNING = { "sbx ls": [{ name: "pi-app-task", agent: "pi", status: "running", workspaces: ["/app"] }] };

test("a stopped container is never executed to read its changes", () => {
	const io = fakeIo({ "sbx ls": [{ name: "pi-app-task", agent: "pi", status: "stopped", workspaces: ["/app"] }] });

	const patch = containerPatch("pi-app-task", io);

	assert.equal(patch, undefined);
	assert.equal(io.calls.some(c => c[0] === "sbx" && c[1] === "exec"), false);
});

test("a removed container has no changes to read", () => {
	const io = fakeIo({ "sbx ls": [] });

	assert.equal(containerPatch("pi-app-task", io), undefined);
});

test("the first read sends no empty sbx command arguments", () => {
	const io = fakeIo({ ...RUNNING, "sbx exec": JSON.stringify("") });

	containerPatch("pi-app-task", io);

	const call = io.calls.find(c => c[0] === "sbx" && c[1] === "exec")!;
	assert.equal(call.includes(""), false);
});

test("every repository of a task is read from its private checkout, its paths under its own name", () => {
	const io = fakeIo({
		"sbx ls": [{ name: "claude-app-task", agent: "claude", status: "running", workspaces: ["/app"] }],
		"read /home/me/.fleet/config/fleet/claude-app-task.json": JSON.stringify({ version: 1, task: "/task", repositories: ["app", "api"].map(name => ({ repo: `/${name}`, workspace: `/private/${name}`, name, base: "main", baseSha: "abc", branch: "task", served: name })) }),
		"sbx exec": JSON.stringify(""),
	});

	containerPatch("claude-app-task", io);

	assert.deepEqual(io.calls.filter(c => c[0] === "sbx" && c[1] === "exec").map(c => JSON.parse(c.at(-1)!)), [
		{ workspace: "/private/app", base: "refs/remotes/origin/main", prefix: "app/" },
		{ workspace: "/private/api", base: "refs/remotes/origin/main", prefix: "api/" },
	]);
});

test("terminal escapes in repository content never reach the viewer", () => {
	const io = fakeIo({ ...RUNNING, "sbx exec": JSON.stringify("+safe\x1b]52;c;ZXZpbA==\x07\x1b[2Jtext\r\n+\tindented\n") });

	assert.equal(containerPatch("pi-app-task", io), "+safe]52;c;ZXZpbA==[2Jtext\n+\tindented\n");
});

test("task changes survive commits and include new untracked files without staging", t => {
	const dir = mkdtempSync(join(tmpdir(), "fleet-diff-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
	git("init", "-q");
	git("config", "user.name", "Diff test");
	git("config", "user.email", "diff@example.test");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(dir, "file.txt"), "before\n");
	writeFileSync(join(dir, ".gitignore"), ".env\n");
	git("add", ".");
	git("commit", "-qm", "base");
	git("update-ref", "refs/fleet/base", "HEAD");
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
	writeFileSync(join(dir, "file.txt"), "committed change\n");
	git("add", ".");
	git("commit", "-qm", "change");
	mkdirSync(join(dir, "new dir"));
	writeFileSync(join(dir, "new dir", "a file.txt"), "untracked change\n");
	writeFileSync(join(dir, ".env"), "secret\n");
	const index = readFileSync(join(dir, ".git/index"));
	const probe = (prefix: string): string => JSON.parse(execFileSync(process.execPath, ["-e", DIFF_PROBE, JSON.stringify({ workspace: dir, base: "", prefix })], { encoding: "utf8" }));

	const plain = probe("");
	const prefixed = probe("app/");

	assert.match(plain, /^diff --git a\/file\.txt b\/file\.txt$/m);
	assert.match(plain, /\+committed change/);
	assert.match(plain, /^diff --git a\/new dir\/a file\.txt b\/new dir\/a file\.txt$/m);
	assert.match(plain, /\+untracked change/);
	assert.doesNotMatch(plain, /secret/);
	assert.match(prefixed, /^\+\+\+ b\/app\/file\.txt$/m);
	assert.match(prefixed, /^\+\+\+ b\/app\/new dir\/a file\.txt\t?$/m);
	assert.deepEqual(readFileSync(join(dir, ".git/index")), index);
});

test("a change that ends on a blank line keeps it, so the patch counts every line of its last hunk", t => {
	const dir = mkdtempSync(join(tmpdir(), "fleet-diff-blank-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
	git("init", "-q");
	git("config", "user.name", "Diff test");
	git("config", "user.email", "diff@example.test");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(dir, "a.txt"), "one\ntwo\n\n");
	writeFileSync(join(dir, "b.txt"), "three\nfour\n\n");
	git("add", ".");
	git("commit", "-qm", "base");
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
	writeFileSync(join(dir, "a.txt"), "ONE\ntwo\n\n");
	writeFileSync(join(dir, "b.txt"), "THREE\nfour\n\n");
	const stdout = execFileSync(process.execPath, ["-e", DIFF_PROBE, JSON.stringify({ workspace: dir, base: "", prefix: "" })], { encoding: "utf8" });
	const io = fakeIo({ ...RUNNING, "sbx exec": stdout.trim() });

	const patch = containerPatch("pi-app-task", io)!;

	assert.deepEqual(patch.split(/^(?=diff --git )/m).map(stanza => stanza.slice(stanza.indexOf("@@"))), [
		"@@ -1,3 +1,3 @@\n-one\n+ONE\n two\n \n",
		"@@ -1,3 +1,3 @@\n-three\n+THREE\n four\n \n",
	]);
});

test("rebasing excludes main changes while keeping branch and uncommitted work", t => {
	const dir = mkdtempSync(join(tmpdir(), "fleet-diff-rebase-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
	git("init", "-qb", "main");
	git("config", "user.name", "Diff test");
	git("config", "user.email", "diff@example.test");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(dir, "base.txt"), "base\n");
	git("add", ".");
	git("commit", "-qm", "base");
	git("update-ref", "refs/fleet/base", "HEAD");
	git("switch", "-qc", "feature");
	writeFileSync(join(dir, "feature.txt"), "feature\n");
	git("add", ".");
	git("commit", "-qm", "feature");
	git("switch", "-q", "main");
	for (let n = 0; n < 20; n++) writeFileSync(join(dir, `main-${n}.txt`), "unrelated upstream change\n");
	git("add", ".");
	git("commit", "-qm", "main moves");
	git("switch", "-q", "feature");
	git("rebase", "main");
	git("switch", "-q", "main");
	writeFileSync(join(dir, "only-on-main.txt"), "not on branch\n");
	git("add", ".");
	git("commit", "-qm", "main moves again");
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	git("switch", "-q", "feature");
	writeFileSync(join(dir, "uncommitted.txt"), "still working\n");

	const patch: string = JSON.parse(execFileSync(process.execPath, ["-e", DIFF_PROBE, JSON.stringify({ workspace: dir, base: "refs/remotes/origin/main", prefix: "" })], { encoding: "utf8" }));

	assert.deepEqual([...patch.matchAll(/^diff --git a\/(\S+)/gm)].map(m => m[1]), ["feature.txt", "uncommitted.txt"]);
});
