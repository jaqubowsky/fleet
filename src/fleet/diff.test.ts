import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DIFF_PROBE, diffSnapshot, toggleDiff, type DiffPosition, type DiffSnapshot } from "./diff.ts";
import { clickedDiffFile, diffDocument, diffOffset, diffInput, diffScreen, plainDiff, scrollDiff } from "./diff-view.ts";
import { fakeIo } from "./fake-io.ts";

const position: DiffPosition = { repository: "", scope: "task", path: "", offset: 0 };

test("the diff shortcut stays inside Herdr prefix mode", () => {
	const config = readFileSync(new URL("../../host/herdr.toml", import.meta.url), "utf8");

	const binding = config.split("[[keys.command]]").find(block => block.includes('command = "fleet diff"'));

	assert.ok(binding);
	assert.match(binding, /key = "prefix\+d"/);
	assert.match(binding, /type = "shell"/);
});

for (const kind of ["pi", "claude"]) {
	test(`${kind} opens a diff beside its agent without taking focus`, () => {
		const name = `${kind}-app-task`;
		const io = fakeIo({
			"herdr pane current": { result: { pane: { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1" } } },
			"herdr pane list": { result: { panes: [] } },
			"herdr tab list": { result: { tabs: [{ tab_id: "w1:t1", label: name }] } },
			"herdr agent list": { result: { agents: [{ tab_id: "w1:t1", name }] } },
			"herdr pane split": { result: { pane: { pane_id: "w1:p2" } } },
			"sbx ls": { sandboxes: [{ name, status: "running", agent: kind, workspaces: ["/app"] }] },
		});

		toggleDiff(undefined, undefined, "/harness", io);

		assert.ok(io.calls.some(c => c.join(" ") === "herdr pane split w1:p1 --direction right --ratio 0.6 --no-focus"));
		assert.ok(io.calls.some(c => c[1] === "pane" && c[2] === "run" && c[4] === `'/harness/bin/fleet' diff '${name}' --view`));
		assert.equal(io.calls.some(c => c[0] === "sbx" && c[1] === "exec"), false);
	});
}

test("the second toggle closes only the recorded diff pane", () => {
	const io = fakeIo({
		"herdr pane current": { result: { pane: { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1" } } },
		"herdr pane list": { result: { panes: [{ pane_id: "w1:p2", tab_id: "w1:t1" }] } },
		"read /home/me/.fleet/cache/diff/panels/w1:t1.json": JSON.stringify({ pane: "w1:p2", tab: "w1:t1" }),
	});

	toggleDiff(undefined, undefined, "/harness", io);

	assert.ok(io.calls.some(c => c.join(" ") === "herdr pane close w1:p2"));
	assert.equal(io.calls.some(c => c[0] === "sbx"), false);
});

test("a stopped container is never executed to read its changes", () => {
	const io = fakeIo({ "sbx ls": { sandboxes: [{ name: "pi-app-task", agent: "pi", status: "stopped", workspaces: ["/app"] }] } });

	const result = diffSnapshot("pi-app-task", position, io);

	assert.equal(result.status, "Container stopped");
	assert.equal(io.calls.some(c => c[0] === "sbx" && c[1] === "exec"), false);
});

test("the first snapshot sends no empty sbx command arguments", () => {
	const io = fakeIo({
		"sbx ls": { sandboxes: [{ name: "pi-app-task", agent: "pi", status: "running", workspaces: ["/app"] }] },
		"sbx exec": JSON.stringify({ files: [], patch: "" }),
	});

	diffSnapshot("pi-app-task", position, io);

	const call = io.calls.find(c => c[0] === "sbx" && c[1] === "exec")!;
	assert.equal(call.includes(""), false);
});

test("a removed container leaves an explicit state", () => {
	const io = fakeIo({ "sbx ls": { sandboxes: [] } });

	const result = diffSnapshot("pi-app-task", position, io);

	assert.equal(result.status, "Container removed");
});

test("a repository choice reads that private checkout", () => {
	const io = fakeIo({
		"sbx ls": { sandboxes: [{ name: "claude-app-task", agent: "claude", status: "running", workspaces: ["/app"] }] },
		"read /home/me/.fleet/config/fleet/claude-app-task.json": JSON.stringify({ version: 1, task: "/task", repositories: ["app", "api"].map(name => ({ repo: `/${name}`, workspace: `/private/${name}`, name, base: "main", baseSha: "abc", branch: "task", served: name })) }),
		"sbx exec": JSON.stringify({ files: [], patch: "" }),
	});

	const result = diffSnapshot("claude-app-task", { ...position, repository: "/api" }, io);

	assert.equal(result.repository, "/api");
	assert.deepEqual(JSON.parse(io.calls.find(c => c[0] === "sbx" && c[1] === "exec")!.at(-1)!), { workspace: "/private/api", scope: "task", base: "refs/remotes/origin/main" });
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
	const probe = (scope: string) => JSON.parse(execFileSync(process.execPath, ["-e", DIFF_PROBE, JSON.stringify({ workspace: dir, scope })], { encoding: "utf8" })) as DiffSnapshot;

	const task = probe("task");
	const uncommitted = probe("uncommitted");

	assert.match(task.patch, /\+committed change/);
	assert.match(task.patch, /\+untracked change/);
	assert.deepEqual(task.files.map(f => f.path), ["file.txt", "new dir/a file.txt"]);
	assert.deepEqual(uncommitted.files.map(f => f.path), ["new dir/a file.txt"]);
	assert.match(uncommitted.patch, /\+untracked change/);
	assert.ok(task.files[1].line > task.files[0].line);
	assert.deepEqual(readFileSync(join(dir, ".git/index")), index);
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

	const result = JSON.parse(execFileSync(process.execPath, ["-e", DIFF_PROBE, JSON.stringify({ workspace: dir, scope: "task", base: "refs/remotes/origin/main" })], { encoding: "utf8" })) as DiffSnapshot;

	assert.deepEqual(result.files.map(f => f.path), ["feature.txt", "uncommitted.txt"]);
});

test("clicking a visible file selects its path", () => {
	const snapshot: DiffSnapshot = { status: "Live", repository: "", repositories: [], files: Array.from({ length: 12 }, (_, i) => ({ path: `file-${i}.ts`, status: "M", line: i })), patch: "" };
	const selected = { ...position, path: "file-8.ts" };

	const path = clickedDiffFile(snapshot, selected, 5, 30);

	assert.equal(path, "file-4.ts");
	assert.equal(clickedDiffFile(snapshot, selected, 3, 30), undefined);
	assert.equal(clickedDiffFile(snapshot, selected, 10, 30), undefined);
});

test("mouse packets never become file-switching keyboard input", () => {
	const first = diffInput("\x1b[<0;12;");

	const next = diffInput(first.pending + "5M\x1b[<0;12;5m\x1b[<65;9;20Mj");

	assert.equal(first.keys, "");
	assert.deepEqual(next.clicks, [{ button: 0, column: 12, row: 5 }, { button: 65, column: 9, row: 20 }]);
	assert.equal(next.keys, "j");
	assert.equal(next.pending, "");
});

test("terminal escapes in repository content cannot control the view", () => {
	const malicious = "text\x1b[2J\x1b]52;c;c2VjcmV0\x07\nnext\rline";

	const safe = plainDiff(malicious);

	assert.equal(safe, "text\nnextline");
});

const continuous: DiffSnapshot = {
	status: "Live", repositories: [], repository: "", base: "origin/main",
	files: [{ path: "one.ts", status: "M", line: 0 }, { path: "two.ts", status: "M", line: 7 }],
	patch: "diff --git a/one.ts b/one.ts\nindex old..new\n--- a/one.ts\n+++ b/one.ts\n@@ -1 +1 @@\n-before one\n+after one\ndiff --git a/two.ts b/two.ts\nindex old..new\n--- a/two.ts\n+++ b/two.ts\n@@ -1 +1 @@\n-before two\n+after two\n",
};

test("one document shows both files with separate headings", () => {
	const document = diffDocument(continuous, continuous.patch, 80);

	const text = plainDiff(document.lines.join("\n"));

	assert.match(text, /1\/2  M  one\.ts[\s\S]*\+after one[\s\S]*2\/2  M  two\.ts[\s\S]*\+after two/);
	assert.doesNotMatch(text, /diff --git|index old/);
});

test("scrolling crosses a file boundary without selecting another file", () => {
	const document = diffDocument(continuous, continuous.patch, 80);

	const next = scrollDiff(document, { ...position, path: "one.ts" }, document.files[1].line);
	const previous = scrollDiff(document, next, -1);

	assert.equal(next.path, "two.ts");
	assert.equal(next.offset, 0);
	assert.equal(previous.path, "one.ts");
	assert.equal(diffOffset(document, previous), document.files[1].line - 1);
});

test("updating an earlier file does not move the reader out of the current file", () => {
	const document = diffDocument(continuous, continuous.patch, 80);
	const reading = { ...position, path: "two.ts", offset: 3 };
	const changed = { ...continuous, files: [continuous.files[0], { ...continuous.files[1], line: 8 }], patch: continuous.patch.replace("+after one\n", "+after one\n+another line\n") };

	const updated = diffDocument(changed, changed.patch, 80);

	assert.equal(updated.lines[diffOffset(updated, reading)], document.lines[diffOffset(document, reading)]);
	assert.equal(diffOffset(updated, reading), diffOffset(document, reading) + 1);
});

test("long colored lines wrap without losing their contents", () => {
	const snapshot = { ...continuous, files: [continuous.files[0]], patch: "@@ -0,0 +1 @@\n+abcdefghijklmnopqrstuvwxyz\n" };

	const document = diffDocument(snapshot, "@@ -0,0 +1 @@\n\x1b[32m+abcdefghijklmnopqrstuvwxyz\x1b[0m\n", 12);
	const rows = document.lines.map(plainDiff);

	assert.ok(rows.every(row => row.length <= 12));
	assert.match(rows.join(""), /\+abcdefghijklmnopqrstuvwxyz/);
});

test("the view retains the selected file and scroll offset across redraws", () => {
	const snapshot: DiffSnapshot = { status: "Live", repositories: [], repository: "", files: [{ path: "a.ts", status: "M", line: 0 }], patch: "" };

	const screen = plainDiff(diffScreen(snapshot, { ...position, path: "a.ts", offset: 2 }, ["first", "second", "third"], "Updated", false, 80, 15));

	assert.match(screen, /> M a.ts/);
	assert.match(screen, /third/);
	assert.doesNotMatch(screen, /first|second/);
});
