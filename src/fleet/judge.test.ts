import assert from "node:assert/strict";
import { test } from "node:test";
import { SEATS } from "../harness.ts";
import { fakeIo } from "./fake-io.ts";
import { benchJudge } from "./judge.ts";

const bench = "/home/me/.fleet/bench";
const repo = "/w/webapp";
const dir = { size: 0, mtime: new Date(0), dir: true };
const verdict = (value: string) =>
	JSON.stringify({ type: "result", is_error: false, total_cost_usd: 0.5, structured_output: { verdict: value, fix: "", reasons: "the filter now excludes the chosen side", rubric: [{ item: "root cause", met: "yes", why: "the query changed" }], false_claims: [] } });

function judgeIo(verdicts: string[]) {
	const run = `${bench}/runs/b3b/t1-1`;
	const task = `${run}/claude-webapp-b3b-t1-1`;
	const io = fakeIo(
		{
			[`list ${bench}/runs/b3b`]: ["t1-1"],
			[`stat ${run}`]: dir,
			[`stat ${task}/browser`]: dir,
			[`stat ${task}/logs`]: dir,
			[`list ${task}/logs`]: ["gate-1", "sessions", "usage.json", "image-stamp"],
			[`stat ${task}/logs/gate-1`]: dir,
			[`list ${task}/logs/gate-1`]: ["side.log"],
			[`stat ${task}/logs/gate-1/side.log`]: { size: 1, mtime: new Date(0), dir: false },
			[`stat ${task}/logs/sessions`]: dir,
			[`list ${task}/logs/sessions`]: ["s.jsonl"],
			[`stat ${task}/logs/sessions/s.jsonl`]: { size: 1, mtime: new Date(0), dir: false },
			[`stat ${task}/logs/usage.json`]: { size: 1, mtime: new Date(0), dir: false },
			[`stat ${task}/logs/image-stamp`]: { size: 1, mtime: new Date(0), dir: false },
			[`stat ${bench}/evals/config`]: dir,
			[`read ${bench}/tasks/t1/task.json`]: JSON.stringify({ base: "1".repeat(40), reference_head: "f".repeat(40) }),
			[`read ${bench}/tasks/t1/ticket.md`]: "# Ticket t1\n\nExclude the side.\n",
			[`read ${bench}/tasks/t1/rubric.md`]: "- the root cause is fixed\n",
			[`git ${repo} diff ${"1".repeat(40)} ${"f".repeat(40)}`]: "diff --git a/ref b/ref\n",
		},
		SEATS.claude,
	);
	io.files[`${run}/result.json`] = JSON.stringify({ task: "t1", rep: 1, status: "done", task_dir: "claude-webapp-b3b-t1-1", closing_message: "Done at 9d290c9.", diff: "diff.patch" });
	io.files[`${run}/diff.patch`] = "diff --git a/run b/run\n";
	io.files[`${task}/ticket.md`] = "- [x] side excluded, test `side.pg.test.ts`\n";
	io.files[`${task}/review.md`] = "PASS on 9d290c9\n";
	io.files[`${task}/logs/gate-1/side.log`] = "5 passed in /runs/b3b/t1-1/claude-webapp-b3b-t1-1\n";
	const prompts: { cwd: string; args: string[]; env: Record<string, string>; seen: Record<string, string> }[] = [];
	io.capture = (command, args, opts) => {
		io.calls.push(["capture", opts.cwd, command, ...args]);
		const seen = Object.fromEntries(Object.entries(io.files).filter(([path]) => path.startsWith(`${opts.cwd}/`)).map(([path, body]) => [path.slice(opts.cwd.length + 1), body]));
		prompts.push({ cwd: opts.cwd, args, env: opts.env, seen });
		return verdicts[prompts.length - 1] ?? "";
	};
	return { io, run, task, prompts };
}

test("judge reads every run of a tag twice with Fable in a scratch copy that names no variant, and records the verdict both passes gave", async () => {
	const { io, run, prompts } = judgeIo([verdict("merge"), verdict("merge"), verdict("merge"), verdict("merge")]);

	await benchJudge({ tag: "b3b", repo, passes: 2 }, io);

	const runs = prompts.filter((call) => call.seen["criteria.md"] !== undefined);
	assert.equal(runs.length, 2);
	for (const call of runs) {
		assert.equal(call.args[call.args.indexOf("--model") + 1], "claude-fable-5-1");
		assert.equal(call.args[call.args.indexOf("--setting-sources") + 1], "project");
		assert.ok(call.cwd.startsWith(io.tmp), call.cwd);
		assert.ok(!call.cwd.includes("b3b") && !call.cwd.includes("control"), call.cwd);
		assert.equal(call.env.CLAUDE_CONFIG_DIR, `${bench}/evals/config`);
	}
	assert.deepEqual(runs[0].seen, {
		"ticket.md": "# Ticket t1\n\nExclude the side.\n",
		"rubric.md": "- the root cause is fixed\n",
		"diff.patch": "diff --git a/run b/run\n",
		"criteria.md": "- [x] side excluded, test `side.pg.test.ts`\n",
		"closing.md": "Done at 9d290c9.",
		"review.md": "PASS on 9d290c9\n",
		"logs/gate-1/side.log": "5 passed in /runs/candidate/t1-1/candidate\n",
	});
	const judged = JSON.parse(io.files[`${run}/judge.json`]);
	assert.equal(judged.verdict, "merge");
	assert.equal(judged.passes.length, 2);
	assert.equal(JSON.parse(io.files[`${run}/result.json`]).judge, "judge.json");
});

test("two passes that disagree mark the run contested", async () => {
	const { io, run } = judgeIo([verdict("merge"), verdict("reject"), verdict("merge"), verdict("merge")]);

	await benchJudge({ tag: "b3b", repo, passes: 2 }, io);

	assert.equal(JSON.parse(io.files[`${run}/judge.json`]).verdict, "contested");
});

test("the seed's merged pull request is judged once as the positive control, from the base to the reference head", async () => {
	const { io, prompts } = judgeIo([verdict("merge"), verdict("merge"), verdict("merge"), verdict("reject")]);

	await benchJudge({ tag: "b3b", repo, passes: 2 }, io);

	const control = prompts.filter((call) => call.seen["criteria.md"] === undefined);
	assert.equal(control.length, 2);
	assert.deepEqual(control[0].seen, { "ticket.md": "# Ticket t1\n\nExclude the side.\n", "rubric.md": "- the root cause is fixed\n", "diff.patch": "diff --git a/ref b/ref\n" });
	assert.equal(JSON.parse(io.files[`${bench}/controls/t1/judge.json`]).verdict, "contested");
});
