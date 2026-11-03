import { createHash } from "node:crypto";
import { CLI, KINDS } from "../harness.ts";
import { OWNED, render, seatTokens } from "../render/render.ts";
import { FLEET } from "./home.ts";
import type { Io } from "./io.ts";
import { harnessStamp, uncommittedImageSources } from "./up.ts";

const READ_ONLY_TOOLS = ["Read", "Grep", "Glob", "Skill"];
const RENDERED = [...OWNED.claude, "CLAUDE.md"];

type Expect = { tool: string; input?: string; absent?: true } | { text: string; absent?: true };
type Call = { tool: string; input: unknown };
type EvalInput = { root: string; cases: string[]; reps: number };
type Result = { case: string; kind: Kind; passes: number; reps: number; prompt_sha256: string; check_sha256: string; fixture_sha256: string };
type Stream = { type?: string; message?: { content?: { type?: string; name?: string; input?: unknown }[] }; result?: string; is_error?: boolean; total_cost_usd?: number; usage?: Record<string, number>; permission_denials?: { tool_name: string; tool_input: unknown }[] };

const EXPECT_KEYS = ["tool", "input", "text", "absent"];
const KINDS_OF_CASE = ["bad", "guard", "control"] as const;
type Kind = (typeof KINDS_OF_CASE)[number];
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const evalsDir = (io: Io) => `${io.home}/${FLEET.bench}/evals`;

function need(io: Io, path: string): string {
	const body = io.read(path);
	if (body === undefined) throw new Error(`missing ${path}`);
	return body;
}

function expectations(path: string, body: string): Expect[] {
	const { expect } = JSON.parse(body) as { expect?: Record<string, unknown>[] };
	if (!Array.isArray(expect) || !expect.length) throw new Error(`${path} needs a non-empty expect list`);
	for (const entry of expect) {
		const stray = Object.keys(entry).find((key) => !EXPECT_KEYS.includes(key));
		if (stray) throw new Error(`${path}: ${stray} is not one of ${EXPECT_KEYS.join(", ")}`);
		if (("tool" in entry) === ("text" in entry)) throw new Error(`${path}: each expectation names a tool or a text, not both or neither`);
		if ("input" in entry && !("tool" in entry)) throw new Error(`${path}: input belongs to a tool expectation`);
		if ("absent" in entry && entry.absent !== true) throw new Error(`${path}: absent takes true or stays out`);
		for (const key of ["tool", "input", "text"]) if (key in entry) new RegExp(String(entry[key]));
	}
	return expect as Expect[];
}

function files(dir: string, io: Io, prefix = ""): string[] {
	return io
		.list(dir)
		.sort()
		.flatMap((name) => (io.stat(`${dir}/${name}`)?.dir ? files(`${dir}/${name}`, io, `${prefix}${name}/`) : [`${prefix}${name}\0${io.read(`${dir}/${name}`) ?? ""}`]));
}

function loadCase(evals: string, id: string, io: Io) {
	const dir = `${evals}/cases/${id}`;
	const { source, kind } = JSON.parse(need(io, `${dir}/case.json`)) as { source: string; kind: Kind };
	if (!KINDS_OF_CASE.includes(kind)) throw new Error(`${dir}/case.json: kind takes bad, guard or control, not ${String(kind)}`);
	const prompt = need(io, `${dir}/prompt.md`);
	const check = need(io, `${dir}/check.json`);
	return { id, dir, source, kind, prompt, check, expect: expectations(`${dir}/check.json`, check), fixture_sha256: sha256(files(`${dir}/fixture`, io).join("\0\0")) };
}

function transcript(stream: string) {
	const events = stream
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as Stream);
	const calls: Call[] = events
		.filter((event) => event.type === "assistant")
		.flatMap((event) => event.message?.content ?? [])
		.filter((block) => block.type === "tool_use")
		.map((block) => ({ tool: block.name ?? "", input: block.input }));
	const result = events.find((event) => event.type === "result");
	const usage = result?.usage ?? {};
	return {
		calls,
		text: result?.result ?? "",
		error: !result ? "the stream holds no result event" : result.is_error ? `claude ended in error: ${result.result ?? ""}` : undefined,
		denied: (result?.permission_denials ?? []).map((denial) => ({ tool: denial.tool_name, input: denial.tool_input })),
		cost_usd: result?.total_cost_usd ?? null,
		tokens: { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, cache_read: usage.cache_read_input_tokens ?? 0, cache_write: usage.cache_creation_input_tokens ?? 0 },
	};
}

function holds(expect: Expect, calls: Call[], text: string): boolean {
	const found =
		"text" in expect
			? new RegExp(expect.text, "i").test(text)
			: calls.some((call) => new RegExp(`^(?:${expect.tool})$`).test(call.tool) && new RegExp(expect.input ?? "", "i").test(JSON.stringify(call.input)));
	return expect.absent ? !found : found;
}

function renderInto(root: string, config: string, io: Io): void {
	const stage = `${io.tmp}/fleet-eval-stage-${io.now().getTime()}`;
	render({ root, agent: "claude", seat: "container", out: stage }, { ...io, write: (path, body) => io.write(path, body.replaceAll("~/.claude/", `${config}/`)) });
	for (const name of RENDERED) {
		io.remove(`${config}/${name}`);
		io.run("cp", ["-R", `${stage}/home/${name}`, `${config}/${name}`]);
	}
	const { effortLevel, autoMemoryEnabled } = JSON.parse(need(io, `${stage}/context/settings.json`)) as Record<string, unknown>;
	io.write(`${config}/settings.json`, `${JSON.stringify({ effortLevel, autoMemoryEnabled }, null, 2)}\n`);
	io.remove(stage);
}

export async function evalRun(input: EvalInput, io: Io): Promise<void> {
	const kind = KINDS.claude;
	const uncommitted = uncommittedImageSources(input.root, kind, io);
	if (uncommitted.length)
		throw new Error(`${input.root} has uncommitted changes in ${uncommitted.join(", ")}; a variant is one commit, so commit them before ${CLI} eval run`);
	const evals = evalsDir(io);
	const config = `${evals}/config`;
	if (!io.stat(config)) throw new Error(`${config} is not logged in yet: run CLAUDE_CONFIG_DIR=${config} claude once and /login`);
	const cases = input.cases.map((id) => loadCase(evals, id, io));
	const variant = harnessStamp(input.root, kind, io);
	const model = seatTokens(io, input.root, kind.name)["models.sbx"];
	renderInto(input.root, config, io);
	for (const one of cases) {
		const out = `${evals}/runs/${variant}/${one.id}`;
		io.remove(out);
		io.mkdir(out);
		const runs: { rep: number; pass?: boolean; error?: string; [field: string]: unknown }[] = [];
		for (let rep = 1; rep <= input.reps; rep++) {
			const scratch = `${io.tmp}/fleet-eval-${variant}-${one.id}-${rep}`;
			try {
				io.remove(scratch);
				io.mkdir(scratch);
				io.run("cp", ["-R", `${one.dir}/fixture/.`, scratch]);
				const stream = io.capture("claude", ["-p", one.prompt, "--model", model, "--output-format", "stream-json", "--verbose", "--permission-mode", "default", "--allowedTools", READ_ONLY_TOOLS.join(",")], { cwd: scratch, env: { CLAUDE_CONFIG_DIR: config } });
				io.write(`${out}/${rep}.jsonl`, stream);
				const { calls, text, error, ...spent } = transcript(stream);
				const failed = one.expect.filter((entry) => !holds(entry, calls, text));
				runs.push({ rep, ...(error ? { error } : { pass: failed.length === 0, failed }), denied: spent.denied, cost_usd: spent.cost_usd, tokens: spent.tokens, transcript: `${rep}.jsonl` });
			} catch (error) {
				runs.push({ rep, error: (error as Error).message });
			} finally {
				io.remove(scratch);
			}
		}
		const passes = runs.filter((run) => run.pass).length;
		const reps = runs.filter((run) => !run.error).length;
		const result = { case: one.id, variant, root: input.root, model, source: one.source, kind: one.kind, passes, reps, errors: input.reps - reps, prompt_sha256: sha256(one.prompt), check_sha256: sha256(one.check), fixture_sha256: one.fixture_sha256, runs };
		io.write(`${out}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
		io.log(`${one.id}: ${passes}/${reps} on ${variant}${reps < input.reps ? `, ${input.reps - reps} errored` : ""} -> ${out}`);
	}
}

export function evalCompare(a: string, b: string, io: Io): void {
	const runs = `${evalsDir(io)}/runs`;
	const results = (variant: string) =>
		new Map(
			io.list(`${runs}/${variant}`).flatMap((id) => {
				const body = io.read(`${runs}/${variant}/${id}/result.json`);
				return body === undefined ? [] : [[id, JSON.parse(body) as Result] as const];
			}),
		);
	const left = results(a);
	const right = results(b);
	const ids = [...new Set([...left.keys(), ...right.keys()])].sort();
	const count = (result?: Result) => (result ? `${result.passes}/${result.reps}` : "-");
	const rows = ids.map((id) => {
		const base = left.get(id);
		const next = right.get(id);
		const kind = base?.kind ?? next?.kind;
		const notes: string[] = kind ? [kind] : [];
		if (kind === "bad" && base && base.reps > 0 && base.passes * 2 >= base.reps) notes.push(`invalid: ${a} passes ${base.passes} of ${base.reps}, so it does not reproduce the original behaviour`);
		if (base && next && (["prompt_sha256", "check_sha256", "fixture_sha256"] as const).some((key) => base[key] !== next[key])) notes.push("not comparable: prompt, check or fixture differs");
		return [id, count(base), count(next), notes.join(", ")];
	});
	const table = [["case", a, b, ""], ...rows];
	const widths = [0, 1, 2].map((column) => Math.max(...table.map((row) => row[column].length)));
	for (const row of table) io.log(row.map((cell, column) => (column < 3 ? cell.padEnd(widths[column]) : cell)).join("  ").trimEnd());
}
