import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SEATS } from "../harness.ts";
import { actions, benchRun, FINAL_COMMITS, FROZEN_BASE, settle, type Settled } from "./bench.ts";
import { fakeIo } from "./fake-io.ts";
import { SAMPLE_PROFILES } from "../profile/fixture.ts";
import { TICKET_STUB } from "./up.ts";

const repo = "/w/webapp";
const seeds = "/home/me/.fleet/bench/tasks";
const runs = "/home/me/.fleet/bench/runs/x";
const shas = { t1: "1".repeat(40), t2: "2".repeat(40) };
const names = ["t1-1", "t1-2", "t2-1", "t2-2"].map((run) => `claude-webapp-x-${run}`);
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const seed = (id: keyof typeof shas) => ({
	ticket: `# Ticket ${id}\n\nDo the thing.\n`,
	task: JSON.stringify({ base: shas[id], reference_head: "f".repeat(40), kind: "bug", grading_boundary: "api" }),
});
const transcript = JSON.stringify({ type: "assistant", timestamp: "2026-11-03T12:00:00Z", message: { id: "m", role: "assistant", model: "claude-opus-5-5", usage: { input_tokens: 1_000_000, output_tokens: 0 }, content: [] } });

function bench() {
	const answers: Record<string, unknown> = {
		"read /root/host/repos.json": SAMPLE_PROFILES,
		"git remote get-url origin": "git@github.com:acme/webapp.git",
		"git rev-parse --abbrev-ref origin/HEAD": "origin/main",
		"git rev-parse --show-toplevel": repo,
		"herdr-app ls": { spaces: [{ id: "sp1", name: "webapp", machine: null }] },
		"herdr-app do tab.new": { tab: "tb1", terminal: "t9" },
		"hc get t9": { state: "live", status: { state: "idle" } },
		"read /home/me/.fleet/cache/claude/image-stamp-x": "a1b2c3d\n",
		"stat /home/me/.fleet/tasks/webapp/runbook": { size: 0, mtime: new Date(0), dir: true },
		[`list ${seeds}/t1`]: ["ticket.md", "task.json", "rubric.md", "screen.png"],
		[`list ${seeds}/t2`]: ["ticket.md", "task.json"],
	};
	for (const id of ["t1", "t2"] as const) {
		answers[`read ${seeds}/${id}/ticket.md`] = seed(id).ticket;
		answers[`read ${seeds}/${id}/task.json`] = seed(id).task;
	}
	for (const [index, name] of names.entries()) {
		const run = name.slice("claude-webapp-x-".length);
		const task = `${runs}/${run}/${name}`;
		const sessions = `${task}/logs/sessions/projects/-w-webapp`;
		answers[`sbx exec ${name} git -C ${repo} rev-parse refs/fleet/base`] = index < 2 ? shas.t1 : shas.t2;
		answers[`sbx exec ${name} node -e`] = JSON.stringify(`diff --git a/${run} b/${run}\n`);
		answers[`sbx exec ${name} sh -c ${FINAL_COMMITS}`] = `${"e".repeat(40)}\t${index}\t${index === 0 ? 0 : 1}`;
		answers[`list ${task}/logs/sessions`] = ["projects"];
		answers[`stat ${task}/logs/sessions/projects`] = { size: 0, mtime: new Date(0), dir: true };
		answers[`list ${task}/logs/sessions/projects`] = ["-w-webapp"];
		answers[`stat ${task}/logs/sessions/projects/-w-webapp`] = { size: 0, mtime: new Date(0), dir: true };
		answers[`list ${sessions}`] = ["s.jsonl"];
		answers[`stat ${sessions}/s.jsonl`] = { size: 1, mtime: new Date(0), dir: false };
		answers[`read ${sessions}/s.jsonl`] = transcript;
	}
	const io = fakeIo(answers, SEATS.claude);
	const created: string[] = [];
	const stopped: string[] = [];
	const sbx = io.sbx;
	io.sbx = (args, opts) => {
		if (args[0] === "run") created.push(args[args.indexOf("--name") + 1]);
		if (args[0] === "stop") stopped.push(args[1]);
		if (args.join(" ") === "ls --json") {
			io.calls.push(["sbx", ...args]);
			return JSON.stringify(created.map((name) => ({ name, agent: "claude", status: stopped.includes(name) ? "stopped" : "running", workspaces: [repo] })));
		}
		return sbx(args, opts);
	};
	io.hc = <T>(args: string[]) => {
		io.calls.push(["hc", ...args]);
		if (args[0] === "ls") return { terminals: created.filter((name) => !stopped.includes(name)).map((name) => ({ address: `t-${name}`, state: "live", status: "idle", turn: 0 })) } as T;
		if (args[0] === "get" && args[1].startsWith("t-")) return { address: args[1], labels: { fleet: "1", "fleet.sandbox": args[1].slice(2) }, state: "live", status: { state: "idle" } } as T;
		return { state: "live", status: { state: "idle" } } as T;
	};
	return { io, created, stopped };
}

const outcomes: Record<string, Settled> = {
	"claude-webapp-x-t1-1": { state: "done", said: "Done. Checks pass at 9d290c9." },
	"claude-webapp-x-t1-2": { state: "done", said: "Stopped.\n\n## Open questions\n\n1. Which modal?" },
	"claude-webapp-x-t2-1": { state: "timeout", said: "" },
	"claude-webapp-x-t2-2": { state: "blocked", said: "Which base?" },
};

const outcome = (state: Settled["state"], said: string) => async (_sandbox: string, _io: unknown, _ms: number, start: () => void): Promise<Settled> => {
	start();
	return { state, said };
};

test("a run counts the screenshots its agents read, main session and subagents apart, and its browser runs", () => {
	const task = "/runs/x/t1-1/claude-webapp-x-t1-1";
	const sessions = `${task}/logs/sessions/projects/-w-webapp`;
	const dir = { size: 0, mtime: new Date(0), dir: true };
	const file = { size: 1, mtime: new Date(0), dir: false };
	const reads = (id: string, ...paths: string[]) =>
		JSON.stringify({ type: "assistant", message: { id, role: "assistant", usage: { input_tokens: 1, output_tokens: 1 }, content: paths.map((file_path) => ({ type: "tool_use", name: "Read", input: { file_path } })) } });
	const io = fakeIo({
		[`list ${task}/logs/sessions`]: ["projects"],
		[`stat ${task}/logs/sessions/projects`]: dir,
		[`list ${task}/logs/sessions/projects`]: ["-w-webapp"],
		[`stat ${task}/logs/sessions/projects/-w-webapp`]: dir,
		[`list ${sessions}`]: ["s.jsonl", "s"],
		[`stat ${sessions}/s.jsonl`]: file,
		[`stat ${sessions}/s`]: dir,
		[`list ${sessions}/s`]: ["subagents"],
		[`stat ${sessions}/s/subagents`]: dir,
		[`list ${sessions}/s/subagents`]: ["agent-a.jsonl"],
		[`stat ${sessions}/s/subagents/agent-a.jsonl`]: file,
		[`read ${sessions}/s.jsonl`]: [reads("m1", "/t/browser/walk-1/01.png", "/w/src/app.ts"), reads("m2", "/t/browser/walk-2/01.PNG")].join("\n"),
		[`read ${sessions}/s/subagents/agent-a.jsonl`]: reads("m3", "/t/browser/walk-2/02.png"),
		[`list ${task}/browser`]: ["walk-1", "walk-2", "notes.md"],
		[`stat ${task}/browser/walk-1`]: dir,
		[`stat ${task}/browser/walk-2`]: dir,
		[`stat ${task}/browser/notes.md`]: file,
	});

	const counted = actions(task, io);

	assert.deepEqual(counted, { screenshots_read: { main: 2, subagents: 1 }, browser_runs: 2 });
});

test("bench run puts each task and rep up on its frozen base, steers it, and keeps a result directory a grader can score without a container", async () => {
	const { io, created, stopped } = bench();
	const steered: string[] = [];

	await benchRun(
		{ root: "/root", repo, image: "my-claude:x", tasks: ["t1", "t2"], reps: 2, parallel: 1, timeoutMs: 60_000 },
		io,
		async (sandbox, _io, timeoutMs, start) => {
			assert.equal(timeoutMs, 60_000);
			start();
			steered.push(sandbox);
			return outcomes[sandbox];
		},
	);

	assert.deepEqual(created, names);
	assert.deepEqual(steered, names);
	assert.deepEqual(stopped, names);
	const statuses: Record<string, string> = {};
	for (const [index, name] of names.entries()) {
		const run = name.slice("claude-webapp-x-".length);
		const id = index < 2 ? "t1" : "t2";
		const dir = `${runs}/${run}`;
		const result = JSON.parse(io.files[`${dir}/result.json`]);
		const sbxRun = io.calls.find((c) => c[0] === "sbx" && c[1] === "run" && c.includes(name))!;
		statuses[run] = result.status;
		assert.equal(sbxRun[sbxRun.indexOf("-t") + 1], "my-claude:x");
		assert.ok(sbxRun.includes(`FLEET_ARTIFACTS=${dir}`), sbxRun.join(" "));
		assert.ok(!sbxRun.includes("--static-mcp"), sbxRun.join(" "));
		assert.ok(io.calls.some((c) => c[0] === "sbx" && c[5]?.startsWith("cd \"$WORKSPACE_DIR\" || exit 1") && c.at(-1) === shas[id]));
		assert.equal(io.files[`${dir}/${name}/ticket.md`], `${TICKET_STUB}${FROZEN_BASE} ${shas[id]}\n\n${seed(id).ticket}`);
		assert.match(io.files[`${dir}/${name}/permissions.md`], /^- push `none`/m);
		assert.equal(io.files[`${dir}/diff.patch`], `diff --git a/${run} b/${run}\n`);
		assert.equal(JSON.parse(io.files[`${dir}/usage.json`]).totals.cost, 4);
		const final = io.calls.find((c) => c[0] === "sbx" && c[2] === name && c[5] === FINAL_COMMITS)!;
		assert.deepEqual(final.slice(7), [shas[id], `${dir}/head.bundle`]);
		assert.ok(io.calls.indexOf(final) < io.calls.findIndex((c) => c[0] === "sbx" && c[1] === "stop" && c[2] === name));
		assert.deepEqual(
			{ image: result.image, seed: result.seed, base: result.base, head: result.head, dirty: result.dirty, bundle: result.bundle, diff: result.diff, usage: result.usage, actions: result.actions, transcripts: result.transcripts, task_dir: result.task_dir },
			{
				image: { ref: "my-claude:x", stamp: "a1b2c3d" },
				seed: { ticket_sha256: sha256(seed(id).ticket), task_sha256: sha256(seed(id).task) },
				base: shas[id],
				head: "e".repeat(40),
				dirty: index,
				bundle: index === 0 ? null : "head.bundle",
				diff: "diff.patch",
				usage: "usage.json",
				actions: { screenshots_read: { main: 0, subagents: 0 }, browser_runs: 0 },
				transcripts: `${name}/logs/sessions`,
				task_dir: name,
			},
		);
	}
	assert.deepEqual(statuses, { "t1-1": "done", "t1-2": "done", "t2-1": "timeout", "t2-2": "blocked" });
	const steer = io.calls.find((c) => c[0] === "hc" && c[1] === "send")!;
	assert.match(steer[3], /ticket\.md/);
	assert.match(steer[3], /end your turn only at Done or on an open question/);
	assert.deepEqual(io.calls.filter((c) => c[0] === "run" && c[1] === "cp" && c[3].startsWith(seeds)).map((c) => c[3]), Array(2).fill(`${seeds}/t1/screen.png`));
	assert.ok(io.calls.some((c) => c[0] === "run" && c[1] === "cp" && c[3] === "/home/me/.fleet/tasks/webapp/runbook" && c[4] === `${runs}/t1-1/runbook`));
	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c.includes("claude") && c[1] === "exec" && c[3] === "claude"));
	const down = io.lines.slice(io.lines.findIndex((line) => /fleet down --force/.test(line)));
	for (const name of names) assert.ok(down.some((line) => line === `fleet down --force ${name}`), down.join("\n"));
});

test("bench run refuses before anything starts when two runs would share a sandbox name", async () => {
	const { io, created } = bench();

	await assert.rejects(
		benchRun({ root: "/root", repo, image: `my-claude:${"x".repeat(60)}`, tasks: ["t1"], reps: 2, parallel: 1, timeoutMs: 1 }, io, async () => ({ state: "done", said: "" })),
		/share the sandbox name/,
	);
	assert.deepEqual(created, []);
});

test("settle starts the run once the watch is on, and answers with the container's settle and its last words", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	t.mock.method(globalThis, "setInterval", (() => 1) as unknown as typeof setInterval);
	t.mock.method(globalThis, "clearInterval", (() => {}) as typeof clearInterval);
	const { io } = bench();
	const name = "claude-webapp-x-t1-1";
	io.sbx(["run", "--name", name], {});
	const said = `${runs}/t1-1/${name}/logs/sessions/projects/-w-webapp`;
	io.files[`/home/me/.fleet/config/fleet/${name}.json`] = JSON.stringify({ version: 1, task: `${runs}/t1-1/${name}`, repositories: [{ repo, name: "acme/webapp", base: "main", baseSha: shas.t1, branch: "x-t1-1", workspace: repo, served: "" }] });
	io.files[`${said}/s.jsonl`] = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done at 9d290c9." }] } });
	const send = (state: string) => {
		for (const follower of io.followers) if (!follower.stopped) follower.onLine(JSON.stringify({ params: { type: "status", terminal: `t-${name}`, data: { status: { state } } } }));
	};

	const done = settle(name, io, 60_000, () => send("working"));
	send("done");
	t.mock.timers.tick(1000);
	const capped = settle(name, io, 60_000, () => send("working"));
	t.mock.timers.tick(60_000);

	assert.deepEqual(await done, { state: "done", said: "Done at 9d290c9." });
	assert.equal((await capped).state, "timeout");
	assert.ok(io.followers.every((follower) => follower.stopped));
});

test("a run is blocked by the criteria its ticket left unticked, not by follow-up questions after the work", async () => {
	const ticking = (ticket: string, said: string) => async (sandbox: string, io: unknown, _ms: number, start: () => void): Promise<Settled> => {
		start();
		(io as ReturnType<typeof fakeIo>).files[`${runs}/t2-1/${sandbox}/ticket.md`] = ticket;
		return { state: "done", said };
	};
	const finished = bench();
	const unfinished = bench();

	await benchRun({ root: "/root", repo, image: "my-claude:x", tasks: ["t2"], reps: 1, parallel: 1, timeoutMs: 1 }, finished.io, ticking("- [x] fixed\n- [x] tested\n", "Done.\n\n## Open questions\n\n- File a follow-up for the chip?"));
	await benchRun({ root: "/root", repo, image: "my-claude:x", tasks: ["t2"], reps: 1, parallel: 1, timeoutMs: 1 }, unfinished.io, ticking("- [x] fixed\n- [ ] tested\n", "Stopped."));

	assert.equal(JSON.parse(finished.io.files[`${runs}/t2-1/result.json`]).status, "done");
	assert.equal(JSON.parse(unfinished.io.files[`${runs}/t2-1/result.json`]).status, "blocked");
});

test("bench run refuses before anything starts when a run directory or a sandbox of the batch is already there", async () => {
	const kept = bench();
	kept.io.stat = (path) => (path === `${runs}/t1-2` ? { size: 0, mtime: new Date(0), dir: true } : undefined);
	const live = bench();
	live.created.push("claude-webapp-x-t1-1");
	live.stopped.push("claude-webapp-x-t1-1");

	await assert.rejects(benchRun({ root: "/root", repo, image: "my-claude:x", tasks: ["t1"], reps: 2, parallel: 1, timeoutMs: 1 }, kept.io, outcome("done", "")), /t1-2 already holds a run/);
	await assert.rejects(benchRun({ root: "/root", repo, image: "my-claude:x", tasks: ["t1"], reps: 2, parallel: 1, timeoutMs: 1 }, live.io, outcome("done", "")), /claude-webapp-x-t1-1 already exists/);
	assert.deepEqual(kept.created, []);
	assert.deepEqual(live.created, ["claude-webapp-x-t1-1"]);
});

test("a run that fails is recorded as an error and stopped, and the batch goes on in its order", async () => {
	const { io, created, stopped } = bench();
	const send = io.hc;
	io.hc = <T>(args: string[]) => {
		if (args[0] === "send" && args[1] === "t-claude-webapp-x-t1-1") throw new Error("hc send failed");
		return send<T>(args);
	};

	await benchRun({ root: "/root", repo, image: "my-claude:x", tasks: ["t1"], reps: 2, parallel: 1, timeoutMs: 1 }, io, outcome("done", "Done."));

	const failed = JSON.parse(io.files[`${runs}/t1-1/result.json`]);
	assert.deepEqual([failed.status, failed.error], ["error", "hc send failed"]);
	assert.equal(JSON.parse(io.files[`${runs}/t1-2/result.json`]).status, "done");
	assert.deepEqual(created, names.slice(0, 2));
	assert.deepEqual(stopped, names.slice(0, 2));
});

test("a run that ends on the account's usage limit is recorded as limit and the batch stops before the next rep starts", async () => {
	const { io, created, stopped } = bench();

	await assert.rejects(
		benchRun({ root: "/root", repo, image: "my-claude:x", tasks: ["t1", "t2"], reps: 2, parallel: 1, timeoutMs: 1 }, io, outcome("error", "You've hit your 5-hour limit · resets 4:30pm (UTC)")),
		/usage limit.*resets 4:30pm \(UTC\).*t1-2, t2-1, t2-2/,
	);

	assert.equal(JSON.parse(io.files[`${runs}/t1-1/result.json`]).status, "limit");
	assert.deepEqual(created, names.slice(0, 1));
	assert.deepEqual(stopped, names.slice(0, 1));
	assert.equal(io.files[`${runs}/t1-2/result.json`], undefined);
});

test("a run whose container came up but whose agent is not logged in is an error, stopped, and on the down list", async () => {
	const { io, stopped } = bench();
	let reads = 0;
	const read = io.hcText;
	io.hcText = (args) => (args[0] === "read" && reads++ === 0 ? "Not logged in" : read(args));

	await benchRun({ root: "/root", repo, image: "my-claude:x", tasks: ["t1"], reps: 2, parallel: 1, timeoutMs: 1 }, io, outcome("done", "Done."));

	const failed = JSON.parse(io.files[`${runs}/t1-1/result.json`]);
	assert.equal(failed.status, "error");
	assert.match(failed.error, /not logged in/);
	assert.deepEqual(stopped, names.slice(0, 2));
	for (const name of names.slice(0, 2)) assert.ok(io.lines.includes(`fleet down --force ${name}`), io.lines.join("\n"));
});

test("base plus the run's bundle rebuilds the final commit, and a run with no commit writes no bundle", (t) => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "bench-bundle-")));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const git = (dir: string, ...args: string[]) =>
		execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();
	const work = join(root, "work");
	execFileSync("git", ["init", "--quiet", "-b", "main", work]);
	git(work, "commit", "--quiet", "--allow-empty", "-m", "base");
	const base = git(work, "rev-parse", "HEAD");
	const grader = join(root, "grader");
	execFileSync("git", ["clone", "--quiet", work, grader], { stdio: "ignore" });
	const final = (bundle: string) =>
		execFileSync("sh", ["-c", FINAL_COMMITS, "--", base, bundle], { env: { ...process.env, WORKSPACE_DIR: work }, encoding: "utf8" }).trim();

	const untouched = final(join(root, "none.bundle"));
	execFileSync("sh", ["-c", "printf 'a\\r\\nb\\0' > blob.bin && echo x > left.txt"], { cwd: work });
	git(work, "add", "blob.bin");
	git(work, "commit", "--quiet", "-m", "work");
	const [head, dirty, bundled] = final(join(root, "head.bundle")).split("\t");
	git(grader, "fetch", "--quiet", join(root, "head.bundle"), "HEAD");

	assert.equal(untouched, `${base}\t0\t0`);
	assert.throws(() => execFileSync("test", ["-e", join(root, "none.bundle")]));
	assert.equal(head, git(work, "rev-parse", "HEAD"));
	assert.equal(dirty, "1");
	assert.equal(bundled, "1");
	assert.equal(git(grader, "rev-parse", "FETCH_HEAD^{tree}"), git(work, "rev-parse", "HEAD^{tree}"));
});

test("a run reset below its base, or given its base as a short sha, writes no bundle and still reports its head", (t) => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "bench-bundle-")));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const git = (dir: string, ...args: string[]) =>
		execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();
	const work = join(root, "work");
	execFileSync("git", ["init", "--quiet", "-b", "main", work]);
	git(work, "commit", "--quiet", "--allow-empty", "-m", "before");
	const before = git(work, "rev-parse", "HEAD");
	git(work, "commit", "--quiet", "--allow-empty", "-m", "base");
	const base = git(work, "rev-parse", "HEAD");
	const final = (sha: string) =>
		execFileSync("sh", ["-c", FINAL_COMMITS, "--", sha, join(root, "head.bundle")], { env: { ...process.env, WORKSPACE_DIR: work }, encoding: "utf8" }).trim();

	const short = final(base.slice(0, 7));
	git(work, "reset", "--quiet", "--hard", before);
	const below = final(base);

	assert.equal(short, `${base}\t0\t0`);
	assert.equal(below, `${before}\t0\t0`);
	assert.throws(() => execFileSync("test", ["-e", join(root, "head.bundle")]));
});
