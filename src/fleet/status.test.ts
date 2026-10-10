import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
	agentFor,
	commitFacts,
	commitsProbe,
	elapsed,
	formatRows,
	parseCheckout,
} from "./status.ts";

test("checkout probe output parses branch, dirty count and head", () => {
	assert.deepEqual(parseCheckout("web-1\t3\tabc"), {
		branch: "web-1",
		dirty: 3,
		head: "abc",
	});
	assert.deepEqual(parseCheckout(""), { branch: "", dirty: 0, head: "" });
});

test("agent lookup by name", () => {
	assert.equal(
		agentFor([{ pane_id: "w1:p1", name: "a", agent_status: "idle" }], "a")
			?.agent_status,
		"idle",
	);
	assert.equal(agentFor([], "a"), undefined);
});

test("rows render aligned with dirty count only when dirty", () => {
	const out = formatRows([
		{
			sandbox: "pi-a",
			status: "running",
			agent: "idle",
			branch: "main",
			dirty: 0,
		},
		{
			sandbox: "pi-long-name",
			status: "running",
			agent: "gone",
			branch: "x",
			dirty: 2,
		},
	]);
	assert.equal(
		out,
		"pi-a          running  idle     main\npi-long-name  running  gone     x  2 uncommitted",
	);
	assert.equal(formatRows([]), "no fleet containers");
});

test("a garbled dirty count reads as zero rather than NaN", () => {
	assert.equal(parseCheckout("main\tabc\tdef").dirty, 0);
});

type Git = (...args: string[]) => string;

function repo(t: TestContext): { dir: string; git: Git } {
	const dir = mkdtempSync(join(tmpdir(), "fleet-commits-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const git: Git = (...args) =>
		execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
			cwd: dir,
			encoding: "utf8",
		}).trim();
	git("init", "-q", "-b", "main");
	git("remote", "add", "origin", dir);
	return { dir, git };
}

function commitFile({ dir, git }: { dir: string; git: Git }, name: string, lines: number) {
	writeFileSync(join(dir, name), "x\n".repeat(lines));
	git("add", name);
	git("commit", "-qm", `add ${name}`);
}

function probe(dir: string): string {
	return execFileSync("sh", ["-c", commitsProbe], {
		env: { ...process.env, WORKSPACE_DIR: dir },
		encoding: "utf8",
	});
}

function onDefault(clone: { git: Git }) {
	clone.git("update-ref", "refs/remotes/origin/main", "HEAD");
	clone.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
}

test("a pushed branch counts its commits from the merge base with origin's default branch", (t) => {
	const clone = repo(t);
	commitFile(clone, "base.txt", 1);
	onDefault(clone);
	clone.git("switch", "-qc", "task");
	commitFile(clone, "one.txt", 2);
	clone.git("update-ref", "refs/remotes/origin/task", "HEAD");
	clone.git("branch", "--set-upstream-to=origin/task");
	commitFile(clone, "two.txt", 3);

	const line = commitFacts(probe(clone.dir));

	assert.match(line, /^2 since origin\/main, 1 pushed, 1 unpushed, 2 files \+5 -0, latest [0-9a-f]{7,} add two\.txt$/);
});

test("an unpushed branch counts every commit as unpushed", (t) => {
	const clone = repo(t);
	commitFile(clone, "base.txt", 1);
	onDefault(clone);
	clone.git("switch", "-qc", "task");
	commitFile(clone, "one.txt", 2);

	assert.match(commitFacts(probe(clone.dir)), /^1 since origin\/main, 0 pushed, 1 unpushed, 1 file \+2 -0, latest/);
});

test("a branch level with origin's default branch has no commits to show", (t) => {
	const clone = repo(t);
	commitFile(clone, "base.txt", 1);
	onDefault(clone);

	assert.equal(commitFacts(probe(clone.dir)), "none since origin/main");
});

test("a clone without origin/HEAD says its commits are not counted", (t) => {
	const clone = repo(t);
	commitFile(clone, "base.txt", 1);

	assert.equal(commitFacts(probe(clone.dir)), "not counted: this clone has no origin/HEAD");
});

test("a clone whose branch shares no history with origin's default branch says so", (t) => {
	const clone = repo(t);
	commitFile(clone, "base.txt", 1);
	onDefault(clone);
	clone.git("switch", "-q", "--orphan", "task");
	commitFile(clone, "other.txt", 1);

	assert.equal(commitFacts(probe(clone.dir)), "not counted: no merge base with origin/main");
});

test("the latest commit is bounded", () => {
	const commits = commitFacts(`task\torigin/main\t10\t10\t 3 files changed\tabc1234 ${"c".repeat(500)}`);

	assert.ok(commits.length < 200);
	assert.match(commits, /^10 since origin\/main, 0 pushed, 10 unpushed, 3 files \+0 -0, latest abc1234 c+\.\.\.$/);
});

test("rows carry the activity projection when the container has one", () => {
	const out = formatRows([
		{
			sandbox: "pi-a",
			status: "running",
			agent: "working",
			branch: "web-1",
			dirty: 0,
			activity: "up 1h 05m, $0.42",
		},
		{ sandbox: "pi-b", status: "stopped", agent: "gone", branch: "?", dirty: 0 },
	]);

	assert.equal(
		out,
		"pi-a  running  working  web-1  up 1h 05m, $0.42\npi-b  stopped  gone     ?",
	);
});

test("elapsed time reads as hours and minutes", () => {
	assert.equal(
		elapsed(new Date("2026-09-16T09:30:00Z"), new Date("2026-09-16T10:35:00Z")),
		"1h 05m",
	);
	assert.equal(
		elapsed(new Date("2026-09-16T10:31:00Z"), new Date("2026-09-16T10:35:00Z")),
		"4m",
	);
});
