import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { test } from "node:test";
import { SEATS } from "../harness.ts";
import { evalCompare, evalRun } from "./evals.ts";
import { fakeIo } from "./fake-io.ts";
import { realIo } from "./io.ts";

const root = resolve(import.meta.dirname, "../..");
const evals = "/home/me/.fleet/bench/evals";
const config = `${evals}/config`;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const editAttempt = { file_path: "/tmp/x/ticket.md", old_string: "- [ ] walked", new_string: "- [x] walked" };
const stream = (final: string, calls: { name: string; input: Record<string, unknown> }[], denied: string[] = []) =>
	[
		{ type: "system", subtype: "init", model: "claude-opus-5-5[1m]" },
		...calls.map((call, index) => ({ type: "assistant", message: { content: [{ type: "tool_use", id: `u${index}`, name: call.name, input: call.input }] } })),
		{ type: "assistant", message: { content: [{ type: "text", text: final }] } },
		{
			type: "result",
			subtype: "success",
			result: final,
			total_cost_usd: 0.25,
			usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 },
			permission_denials: calls
				.map((call, index) => ({ tool_name: call.name, tool_use_id: `u${index}`, tool_input: call.input }))
				.filter((denial) => denied.includes(denial.tool_name)),
		},
	]
		.map((event) => JSON.stringify(event))
		.join("\n");

const cases = {
	rewalk: {
		case: JSON.stringify({ source: "/x/session.jsonl:42", kind: "bad" }),
		prompt: "The copy fix landed. Which criteria do you walk again?",
		check: JSON.stringify({ expect: [{ tool: "Edit|Write", absent: true }, { text: "criterion 2 only" }] }),
	},
	plain: {
		case: JSON.stringify({ source: "/x/session.jsonl:43", kind: "control" }),
		prompt: "Which file holds the walk report?",
		check: JSON.stringify({ expect: [{ tool: "Read", input: "report\\.md" }] }),
	},	history: {
		case: JSON.stringify({ source: "/x/session.jsonl:44", kind: "guard" }),
		prompt: "Rewrite the gotcha so it is true now.",
		check: JSON.stringify({ expect: [{ text: "groups/", absent: true }] }),
	},
};

function evalIo(streams: string[]) {
	const answers: Record<string, unknown> = {
		[`git ${root} status --porcelain`]: "",
		[`git ${root} log -1 --format=%h`]: "abc1234",
		[`stat ${config}`]: { size: 0, mtime: new Date(0), dir: true },
	};
	for (const [id, body] of Object.entries(cases)) {
		answers[`read ${evals}/cases/${id}/case.json`] = body.case;
		answers[`read ${evals}/cases/${id}/prompt.md`] = body.prompt;
		answers[`read ${evals}/cases/${id}/check.json`] = body.check;
	}
	const io = fakeIo(answers, SEATS.claude);
	const real = realIo(io.home);
	const fake = { read: io.read, list: io.list, stat: io.stat };
	const own = (path: string) => path.startsWith(`${root}/`);
	io.read = (path) => (own(path) ? real.read(path) : fake.read(path));
	io.list = (dir) => (own(dir) ? real.list(dir) : fake.list(dir));
	io.stat = (path) => (own(path) ? real.stat(path) : fake.stat(path));
	const runs: { args: string[]; cwd: string; env: Record<string, string> }[] = [];
	io.capture = (command, args, opts) => {
		io.calls.push(["capture", opts.cwd, command, ...args]);
		runs.push({ args, cwd: opts.cwd, env: opts.env });
		return streams[runs.length - 1] ?? "";
	};
	return { io, runs };
}

test("a run renders the variant into the eval config dir and keeps its login", async () => {
	const { io } = evalIo([stream("criterion 2 only", [])]);

	await evalRun({ root, cases: ["rewalk"], reps: 1 }, io);

	const removed = io.calls.filter((call) => call[0] === "remove" && call[1].startsWith(config)).map((call) => call[1]);
	assert.deepEqual(removed.sort(), ["CLAUDE.md", "agents", "refs", "rules", "skills"].map((name) => `${config}/${name}`));
	const copied = io.calls.filter((call) => call[0] === "run" && call[1] === "cp" && call.at(-1)?.startsWith(config)).map((call) => call.at(-1));
	assert.deepEqual(copied.sort(), ["CLAUDE.md", "agents", "refs", "rules", "skills"].map((name) => `${config}/${name}`));
	const stage = io.calls.find((call) => call[0] === "run" && call[1] === "cp" && call.at(-1) === `${config}/rules`)![3].replace(/\/home\/rules$/, "");
	assert.ok(io.calls.some((call) => call[0] === "write" && call[1] === `${stage}/home/rules/sandbox.md`));
	assert.ok(io.calls.some((call) => call[0] === "remove" && call[1] === stage));
	assert.ok(!io.calls.some((call) => call[0] === "run" && String(call.at(-1)).endsWith(`${config}/settings.json`)));
});

test("a run copies the fixture to a fresh scratch dir and runs claude -p read-only in it", async () => {
	const { io, runs } = evalIo([stream("criterion 2 only", [])]);

	await evalRun({ root, cases: ["rewalk"], reps: 1 }, io);

	const [run] = runs;
	assert.equal(run.env.CLAUDE_CONFIG_DIR, config);
	assert.deepEqual(io.calls.find((call) => call[0] === "run" && call[1] === "cp" && call[3]?.endsWith("/fixture/.")), ["run", "cp", "-R", `${evals}/cases/rewalk/fixture/.`, run.cwd]);
	assert.deepEqual(run.args, [
		"-p",
		cases.rewalk.prompt,
		"--model",
		"claude-opus-5-5[1m]",
		"--output-format",
		"stream-json",
		"--verbose",
		"--permission-mode",
		"default",
		"--allowedTools",
		"Read,Grep,Glob,Skill",
	]);
	assert.ok(io.calls.some((call) => call[0] === "remove" && call[1] === run.cwd));
});

test("a denied write stays in the transcript and fails the check that forbids it", async () => {
	const transcript = stream("criterion 2 only", [{ name: "Edit", input: editAttempt }], ["Edit"]);
	const { io } = evalIo([transcript]);

	await evalRun({ root, cases: ["rewalk"], reps: 1 }, io);

	const result = JSON.parse(io.files[`${evals}/runs/abc1234/rewalk/result.json`]);
	assert.equal(io.files[`${evals}/runs/abc1234/rewalk/1.jsonl`], transcript);
	assert.equal(result.passes, 0);
	assert.deepEqual(result.runs[0].denied, [{ tool: "Edit", input: editAttempt }]);
	assert.deepEqual(result.runs[0].failed, [{ tool: "Edit|Write", absent: true }]);
});

test("a run counts passes over reps with cost, tokens and each transcript", async () => {
	const { io } = evalIo([stream("criterion 2 only", []), stream("I walk every criterion again", []), stream("Criterion 2 only.", [])]);

	await evalRun({ root, cases: ["rewalk"], reps: 3 }, io);

	const result = JSON.parse(io.files[`${evals}/runs/abc1234/rewalk/result.json`]);
	assert.equal(result.variant, "abc1234");
	assert.equal(result.model, "claude-opus-5-5[1m]");
	assert.equal(result.passes, 2);
	assert.equal(result.reps, 3);
	assert.equal(result.prompt_sha256, sha256(cases.rewalk.prompt));
	assert.equal(result.check_sha256, sha256(cases.rewalk.check));
	assert.deepEqual(result.runs[1], {
		rep: 2,
		pass: false,
		failed: [{ text: "criterion 2 only" }],
		denied: [],
		cost_usd: 0.25,
		tokens: { input: 10, output: 20, cache_read: 300, cache_write: 40 },
		transcript: "2.jsonl",
	});
});

test("a dirty variant is refused, naming its files, since a variant is one commit", async () => {
	const { io, runs } = evalIo([]);
	io.git = (args) => (args[0] === "status" ? "M skills/container/check-feature/SKILL.md" : "abc1234");

	await assert.rejects(evalRun({ root, cases: ["rewalk"], reps: 1 }, io), /uncommitted changes in skills\/container\/check-feature\/SKILL\.md/);
	assert.equal(runs.length, 0);
});

test("a run before the eval config dir's one-time login is refused before any render", async () => {
	const { io, runs } = evalIo([]);
	io.stat = () => undefined;

	await assert.rejects(evalRun({ root, cases: ["rewalk"], reps: 1 }, io), /evals\/config is not logged in yet/);
	assert.equal(runs.length, 0);
	assert.ok(!io.calls.some((call) => call[0] === "write"));
});

test("compare prints pass counts side by side, labels each case by its kind, and flags only a bad case the baseline already passes", () => {
	const io = fakeIo({}, SEATS.claude);
	const result = (variant: string, id: keyof typeof cases, passes: number, reps = 3) =>
		JSON.stringify({ case: id, variant, kind: JSON.parse(cases[id].case).kind, passes, reps, prompt_sha256: sha256(cases[id].prompt), check_sha256: sha256(cases[id].check), fixture_sha256: "f", runs: [] });
	io.files[`${evals}/runs/base/rewalk/result.json`] = result("base", "rewalk", 2);
	io.files[`${evals}/runs/base/plain/result.json`] = result("base", "plain", 3);
	io.files[`${evals}/runs/base/history/result.json`] = result("base", "history", 3);
	io.files[`${evals}/runs/next/rewalk/result.json`] = result("next", "rewalk", 3);
	io.files[`${evals}/runs/next/plain/result.json`] = result("next", "plain", 1);
	io.files[`${evals}/runs/next/history/result.json`] = result("next", "history", 3);
	io.list = (dir) => (dir.endsWith("/runs/base") || dir.endsWith("/runs/next") ? ["rewalk", "plain", "history"] : []);

	evalCompare("base", "next", io);

	assert.deepEqual(io.lines, [
		"case     base  next",
		"history  3/3   3/3   guard",
		"plain    3/3   1/3   control",
		"rewalk   2/3   3/3   bad, invalid: base passes 2 of 3, so it does not reproduce the original behaviour",
	]);
});

test("a case.json whose kind is not bad, guard or control is refused before any run", async () => {
	const { io, runs } = evalIo([]);
	io.files[`${evals}/cases/plain/case.json`] = JSON.stringify({ source: "/x/session.jsonl:43", control: true });

	await assert.rejects(evalRun({ root, cases: ["plain"], reps: 1 }, io), /plain\/case\.json: kind takes bad, guard or control/);
	assert.equal(runs.length, 0);
});

test("compare marks a case whose fixture changed between the variants as not comparable", () => {
	const io = fakeIo({}, SEATS.claude);
	const base = { case: "plain", kind: "control", passes: 3, reps: 3, prompt_sha256: "p", check_sha256: "c", fixture_sha256: "f", runs: [] };
	io.files[`${evals}/runs/base/plain/result.json`] = JSON.stringify(base);
	io.files[`${evals}/runs/next/plain/result.json`] = JSON.stringify({ ...base, fixture_sha256: "other" });
	io.list = (dir) => (dir.includes("/runs/") ? ["plain"] : []);

	evalCompare("base", "next", io);

	assert.deepEqual(io.lines, ["case   base  next", "plain  3/3   3/3   control, not comparable: prompt, check or fixture differs"]);
});

test("a run points the rendered rules' ~/.claude paths at the eval config dir and keeps the variant's effort and memory settings", async () => {
	const { io } = evalIo([stream("criterion 2 only", [])]);
	const written: Record<string, string> = {};
	const write = io.write;
	io.write = (path, body) => {
		written[path] = body;
		write(path, body);
	};

	await evalRun({ root, cases: ["rewalk"], reps: 1 }, io);

	const core = Object.entries(written).find(([path]) => path.endsWith("/home/rules/core.md"))![1];
	assert.match(core, new RegExp(`${config}/refs/prose\\.md`));
	assert.doesNotMatch(core, /~\/\.claude\//);
	assert.deepEqual(JSON.parse(io.files[`${config}/settings.json`]), { effortLevel: "medium", autoMemoryEnabled: false });
});

test("a rep whose claude fails or ends in error is recorded as an error, its scratch dir removed, and the batch goes on", async () => {
	const { io } = evalIo([]);
	const errored = [{ type: "result", subtype: "error_during_execution", is_error: true, result: "API Error" }].map((event) => JSON.stringify(event)).join("\n");
	const streams = [new Error("claude -p failed (1)\nNot logged in"), errored, stream("criterion 2 only", []), stream("x", [{ name: "Read", input: { file_path: "report.md" } }])];
	io.capture = (_command, _args, opts) => {
		io.calls.push(["capture", opts.cwd]);
		const next = streams.shift()!;
		if (next instanceof Error) throw next;
		return next;
	};

	await evalRun({ root, cases: ["rewalk", "plain"], reps: 3 }, io);

	const rewalk = JSON.parse(io.files[`${evals}/runs/abc1234/rewalk/result.json`]);
	assert.deepEqual([rewalk.passes, rewalk.reps, rewalk.errors], [1, 1, 2]);
	assert.match(rewalk.runs[0].error, /Not logged in/);
	assert.match(rewalk.runs[1].error, /API Error/);
	assert.ok(io.calls.some((call) => call[0] === "remove" && call[1] === "/tmp/fleet-eval-abc1234-rewalk-1"));
	assert.equal(JSON.parse(io.files[`${evals}/runs/abc1234/plain/result.json`]).passes, 1);
});

test("a rerun of a case under the same variant replaces its earlier results", async () => {
	const { io } = evalIo([stream("criterion 2 only", [])]);

	await evalRun({ root, cases: ["rewalk"], reps: 1 }, io);

	const out = `${evals}/runs/abc1234/rewalk`;
	const removed = io.calls.findIndex((call) => call[0] === "remove" && call[1] === out);
	assert.ok(removed >= 0 && removed < io.calls.findIndex((call) => call[0] === "write" && call[1] === `${out}/1.jsonl`));
});

test("a check with a stray key, a bad pattern or no tool or text is refused before any render or run", async () => {
	for (const check of [{ expect: [{ text: "x", absnet: true }] }, { expect: [{ text: "(" }] }, { expect: [{ absent: true }] }, { expect: [] }]) {
		const { io, runs } = evalIo([]);
		io.files[`${evals}/cases/rewalk/check.json`] = JSON.stringify(check);

		await assert.rejects(evalRun({ root, cases: ["rewalk"], reps: 1 }, io));
		assert.equal(runs.length, 0);
		assert.ok(!io.calls.some((call) => call[0] === "remove" && call[1].startsWith(config)));
	}
});
