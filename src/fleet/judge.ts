import { CLI } from "../harness.ts";
import { collect } from "./commands.ts";
import { FLEET } from "./home.ts";
import type { Io } from "./io.ts";
import { slug } from "./name.ts";

const JUDGE = "claude-fable-5-1";
const TOOLS = "Read,Grep,Glob";
const VERDICTS = ["merge", "merge_after_fix", "reject", "unknown"];
const SCHEMA = JSON.stringify({
	type: "object",
	properties: {
		verdict: { type: "string", enum: VERDICTS },
		fix: { type: "string" },
		reasons: { type: "string" },
		rubric: { type: "array", items: { type: "object", properties: { item: { type: "string" }, met: { type: "string", enum: ["yes", "no", "unknown"] }, why: { type: "string" } }, required: ["item", "met", "why"] } },
		false_claims: { type: "array", items: { type: "string" } },
	},
	required: ["verdict", "fix", "reasons", "rubric", "false_claims"],
});
const PROMPT = `You review one candidate change for the ticket in ticket.md and decide whether it merges. The files in this directory: ticket.md, the ticket as written; rubric.md, what this ticket's reviewers checked, when present; diff.patch, the change; criteria.md, the acceptance criteria as the author ticked them with their evidence, when present; closing.md, the author's closing message, when present; analysis.md and review.md, the author's analysis and its independent review, when present; browser/, walk reports and screenshots, and logs/, the check logs the criteria cite, when present.

Read the whole diff and open the evidence it names. The verdict is about the change alone: would a reviewer who reads the ticket and the diff merge it. Judge the behaviour the ticket asks for, never the code's likeness to another solution, and never lower the verdict for evidence, a closing message or answers to the ticket's questions that this directory lacks; those belong in false_claims only where the author claimed them. Answer merge when it merges as is, merge_after_fix when one small fix would make it mergeable (name it in fix), reject when it should not merge (say why in reasons), and unknown when these files cannot settle it. Rate every rubric item yes, no or unknown with one sentence why. List in false_claims every ticked criterion or claimed check whose evidence is missing or says otherwise.`;

type Pass = { verdict?: string; error?: string; cost_usd?: number | null; [field: string]: unknown };
type Candidate = { files: Record<string, string>; dirs?: { from: string; to: string; skip?: string[] }[]; scrub?: string[] };
const BINARY = /\.(png|jpe?g|gif|webp|webm|mp4|pdf|zip|gz|bundle)$/i;

function onePass(candidate: Candidate, config: string, scratch: string, io: Io): Pass {
	io.remove(scratch);
	io.mkdir(scratch);
	try {
		for (const [name, body] of Object.entries(candidate.files)) io.write(`${scratch}/${name}`, body);
		for (const { from, to, skip = [] } of candidate.dirs ?? []) {
			for (const { path } of collect(from, "", io, [])) {
				if (skip.some((name) => path === name || path.startsWith(`${name}/`))) continue;
				const target = `${scratch}/${to}/${path}`;
				io.mkdir(target.slice(0, target.lastIndexOf("/")));
				if (BINARY.test(path)) io.run("cp", [`${from}/${path}`, target]);
				else io.write(target, (candidate.scrub ?? []).reduce((text, name) => text.replaceAll(name, "candidate"), io.read(`${from}/${path}`) ?? ""));
			}
		}
		const out = io.capture("claude", ["-p", PROMPT, "--model", JUDGE, "--setting-sources", "project", "--tools", TOOLS, "--allowedTools", TOOLS, "--no-session-persistence", "--output-format", "json", "--json-schema", SCHEMA], { cwd: scratch, env: { CLAUDE_CONFIG_DIR: config } });
		const result = JSON.parse(out) as { is_error?: boolean; result?: string; structured_output?: Record<string, unknown>; total_cost_usd?: number };
		if (result.is_error || !result.structured_output) return { error: `the judge answered no verdict: ${result.result ?? out.slice(0, 200)}`, cost_usd: result.total_cost_usd ?? null };
		return { ...result.structured_output, cost_usd: result.total_cost_usd ?? null };
	} catch (error) {
		return { error: (error as Error).message };
	} finally {
		io.remove(scratch);
	}
}

function judge(candidate: Candidate, passes: number, config: string, io: Io, next: () => string) {
	const all = Array.from({ length: passes }, () => onePass(candidate, config, next(), io));
	const verdicts = new Set(all.map((pass) => pass.verdict));
	const verdict = all.some((pass) => pass.error) ? "error" : verdicts.size === 1 ? [...verdicts][0] : "contested";
	return { model: JUDGE, verdict, passes: all, judged_at: io.now().toISOString() };
}

export async function benchJudge(input: { tag: string; repo: string; passes: number; tasks?: string[] }, io: Io): Promise<void> {
	const bench = `${io.home}/${FLEET.bench}`;
	const config = `${bench}/evals/config`;
	if (!io.stat(config)) throw new Error(`${config} is not logged in yet: run CLAUDE_CONFIG_DIR=${config} claude once and /login`);
	let count = 0;
	const next = () => `${io.tmp}/fleet-judge-${io.now().getTime()}-${++count}`;
	const runs = `${bench}/runs/${slug(input.tag)}`;
	const tasks = new Set<string>();
	for (const name of io.list(runs)) {
		const body = io.read(`${runs}/${name}/result.json`);
		if (body === undefined) continue;
		const result = JSON.parse(body) as { task: string; status: string; task_dir?: string; closing_message?: string; diff?: string; sandbox?: string };
		if (input.tasks && !input.tasks.includes(result.task)) continue;
		if (!result.diff || !result.task_dir) {
			io.log(`${name}: ${result.status}, no diff to judge`);
			continue;
		}
		tasks.add(result.task);
		const seed = `${bench}/tasks/${result.task}`;
		const task = `${runs}/${name}/${result.task_dir}`;
		const scrub = [`${runs}/${name}`, result.task_dir, input.tag];
		const files: Record<string, string> = { "ticket.md": io.read(`${seed}/ticket.md`) ?? "", "diff.patch": io.read(`${runs}/${name}/${result.diff}`) ?? "" };
		const rubric = io.read(`${seed}/rubric.md`);
		if (rubric !== undefined) files["rubric.md"] = rubric;
		const criteria = io.read(`${task}/ticket.md`);
		if (criteria !== undefined) files["criteria.md"] = scrub.reduce((text, word) => text.replaceAll(word, "candidate"), criteria);
		if (result.closing_message) files["closing.md"] = result.closing_message;
		for (const name of ["analysis.md", "review.md"]) {
			const body = io.read(`${task}/${name}`);
			if (body !== undefined) files[name] = scrub.reduce((text, word) => text.replaceAll(word, "candidate"), body);
		}
		const dirs = [
			{ from: `${task}/browser`, to: "browser" },
			{ from: `${task}/logs`, to: "logs", skip: ["sessions", "activity.jsonl", "usage.json", "memory.json", "image-stamp"] },
		].filter((one) => io.stat(one.from)?.dir);
		const judged = judge({ files, dirs, scrub }, input.passes, config, io, next);
		io.write(`${runs}/${name}/judge.json`, `${JSON.stringify(judged, null, 2)}\n`);
		io.write(`${runs}/${name}/result.json`, `${JSON.stringify({ ...JSON.parse(body), judge: "judge.json" }, null, 2)}\n`);
		io.log(`${name}: ${judged.verdict}`);
	}
	for (const id of tasks) {
		const out = `${bench}/controls/${id}`;
		if (io.stat(`${out}/judge.json`)) continue;
		const seed = `${bench}/tasks/${id}`;
		const { base, reference_head } = JSON.parse(io.read(`${seed}/task.json`) ?? "{}") as { base?: string; reference_head?: string };
		if (!base || !reference_head) {
			io.log(`${id}: task.json names no base and reference_head, so no control`);
			continue;
		}
		const files: Record<string, string> = { "ticket.md": io.read(`${seed}/ticket.md`) ?? "", "diff.patch": io.git(["diff", base, reference_head], input.repo) };
		const rubric = io.read(`${seed}/rubric.md`);
		if (rubric !== undefined) files["rubric.md"] = rubric;
		const judged = judge({ files }, input.passes, config, io, next);
		io.mkdir(out);
		io.write(`${out}/diff.patch`, files["diff.patch"]);
		io.write(`${out}/judge.json`, `${JSON.stringify(judged, null, 2)}\n`);
		io.log(`${id} control (merged pull request): ${judged.verdict}`);
	}
	if (!tasks.size) io.log(`${runs} holds no run with a diff; ${CLI} bench run writes them`);
}
