import { createHash } from "node:crypto";
import { CLI, KINDS } from "../harness.ts";
import { OWNED, render, seatTokens } from "../render/render.ts";
import { FLEET } from "./home.ts";
import type { Io } from "./io.ts";
import { harnessStamp, uncommittedImageSources } from "./up.ts";

const READ_ONLY_TOOLS = ["Read", "Grep", "Glob", "Skill"];
const RENDERED = [...OWNED.claude, "CLAUDE.md"];

type Expect = { tool?: string; input?: string; text?: string; absent?: true };
type Call = { tool: string; input: unknown };
type EvalInput = { root: string; cases: string[]; reps: number };
type Result = { case: string; control: boolean; passes: number; reps: number; prompt_sha256: string; check_sha256: string };

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const evalsDir = (io: Io) => `${io.home}/${FLEET.bench}/evals`;

function need(io: Io, path: string): string {
	const body = io.read(path);
	if (body === undefined) throw new Error(`missing ${path}`);
	return body;
}

function transcript(stream: string) {
	const events = stream
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as { type?: string; message?: { content?: { type?: string; name?: string; input?: unknown }[] }; result?: string; total_cost_usd?: number; usage?: Record<string, number>; permission_denials?: { tool_name: string; tool_input: unknown }[] });
	const calls: Call[] = events
		.filter((event) => event.type === "assistant")
		.flatMap((event) => event.message?.content ?? [])
		.filter((block) => block.type === "tool_use")
		.map((block) => ({ tool: block.name ?? "", input: block.input }));
	const result = events.find((event) => event.type === "result") ?? {};
	const usage = result.usage ?? {};
	return {
		calls,
		text: result.result ?? "",
		denied: (result.permission_denials ?? []).map((denial) => ({ tool: denial.tool_name, input: denial.tool_input })),
		cost_usd: result.total_cost_usd ?? null,
		tokens: { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, cache_read: usage.cache_read_input_tokens ?? 0, cache_write: usage.cache_creation_input_tokens ?? 0 },
	};
}

function holds(expect: Expect, calls: Call[], text: string): boolean {
	const found =
		expect.text !== undefined
			? new RegExp(expect.text, "i").test(text)
			: calls.some((call) => new RegExp(`^(?:${expect.tool ?? ".*"})$`).test(call.tool) && new RegExp(expect.input ?? "", "i").test(JSON.stringify(call.input)));
	return expect.absent ? !found : found;
}

function renderInto(root: string, config: string, io: Io): void {
	const stage = `${io.tmp}/fleet-eval-stage-${io.now().getTime()}`;
	render({ root, agent: "claude", seat: "container", out: stage }, io);
	for (const name of RENDERED) {
		io.remove(`${config}/${name}`);
		io.run("cp", ["-R", `${stage}/home/${name}`, `${config}/${name}`]);
	}
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
	const variant = harnessStamp(input.root, kind, io);
	const model = seatTokens(io, input.root, kind.name)["models.sbx"];
	renderInto(input.root, config, io);
	for (const id of input.cases) {
		const dir = `${evals}/cases/${id}`;
		const { source, control } = JSON.parse(need(io, `${dir}/case.json`)) as { source: string; control: boolean };
		const prompt = need(io, `${dir}/prompt.md`);
		const check = need(io, `${dir}/check.json`);
		const { expect } = JSON.parse(check) as { expect: Expect[] };
		const out = `${evals}/runs/${variant}/${id}`;
		io.mkdir(out);
		const runs = [];
		for (let rep = 1; rep <= input.reps; rep++) {
			const scratch = `${io.tmp}/fleet-eval-${variant}-${id}-${rep}`;
			io.remove(scratch);
			io.mkdir(scratch);
			io.run("cp", ["-R", `${dir}/fixture/.`, scratch]);
			const stream = io.capture("claude", ["-p", prompt, "--model", model, "--output-format", "stream-json", "--verbose", "--permission-mode", "default", "--allowedTools", READ_ONLY_TOOLS.join(",")], { cwd: scratch, env: { CLAUDE_CONFIG_DIR: config } });
			io.remove(scratch);
			io.write(`${out}/${rep}.jsonl`, stream);
			const { calls, text, ...spent } = transcript(stream);
			const failed = expect.filter((entry) => !holds(entry, calls, text));
			runs.push({ rep, pass: failed.length === 0, failed, denied: spent.denied, cost_usd: spent.cost_usd, tokens: spent.tokens, transcript: `${rep}.jsonl` });
		}
		const passes = runs.filter((run) => run.pass).length;
		const result = { case: id, variant, root: input.root, model, source, control, passes, reps: input.reps, prompt_sha256: sha256(prompt), check_sha256: sha256(check), runs };
		io.write(`${out}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
		io.log(`${id}: ${passes}/${input.reps} on ${variant} -> ${out}`);
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
		const notes = [];
		if (base?.control ?? next?.control) notes.push("control");
		else if (base && base.passes * 2 >= base.reps) notes.push(`invalid: ${a} passes ${base.passes} of ${base.reps}, so it does not reproduce the original behaviour`);
		if (base && next && (base.prompt_sha256 !== next.prompt_sha256 || base.check_sha256 !== next.check_sha256)) notes.push("not comparable: prompt or check differs");
		return [id, count(base), count(next), notes.join(", ")];
	});
	const table = [["case", a, b, ""], ...rows];
	const widths = [0, 1, 2].map((column) => Math.max(...table.map((row) => row[column].length)));
	for (const row of table) io.log(row.map((cell, column) => (column < 3 ? cell.padEnd(widths[column]) : cell)).join("  ").trimEnd());
}
