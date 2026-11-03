import { relative } from "node:path";
import { marked } from "marked";
import { collect } from "./commands.ts";
import { FLEET } from "./home.ts";
import type { Io } from "./io.ts";

type Result = { task: string; rep: number; status: string; task_dir?: string; closing_message?: string; diff?: string; usage?: string | null; judge?: string | null; actions?: { screenshots_read: { main: number; subagents: number }; browser_runs: number }; image?: { ref: string; stamp: string | null }; base?: string; head?: string; error?: string };
type Judged = { verdict: string; passes?: { verdict?: string; reasons?: string; fix?: string; error?: string; rubric?: { item: string; met: string; why: string }[]; false_claims?: string[] }[] };
type Run = { tag: string; name: string; dir: string; result: Result; usage?: { totals: Record<string, number> }; judge?: Judged };

const CSS = `body{font:15px/1.5 system-ui,sans-serif;color:#1d1d1f;background:#fff;margin:2rem auto;max-width:72rem;padding:0 1.5rem}
h1{font-size:1.4rem;margin:0 0 .25rem}h2{font-size:1.1rem;margin:2rem 0 .5rem}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:.5rem .75rem;border-bottom:1px solid #e5e5e7}
th{font-weight:600;background:#f5f5f7}td small{color:#6e6e73;display:block}a{color:#0b57d0}
pre{background:#f5f5f7;padding:1rem;overflow:auto;font-size:12.5px;max-height:40rem}
.frames{display:grid;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr));gap:.75rem}.frames figure{margin:0}.frames img{width:100%;border:1px solid #e5e5e7}.frames figcaption{font-size:12px;color:#6e6e73;overflow-wrap:anywhere}
.report{border-left:3px solid #e5e5e7;padding-left:1rem}`;

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const page = (title: string, body: string) => `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title><style>${CSS}</style></head><body>${body}</body></html>\n`;
const json = <T>(io: Io, path: string): T | undefined => {
	const body = io.read(path);
	return body === undefined ? undefined : (JSON.parse(body) as T);
};
const verdictText = (verdict?: string) => (verdict ?? "not judged").replaceAll("_", " ");
const screenshots = (result: Result) => (result.actions ? result.actions.screenshots_read.main + result.actions.screenshots_read.subagents : undefined);

function cell(run: Run): string {
	const totals = run.usage?.totals;
	const shots = screenshots(run.result);
	const lines = [
		totals ? `$${totals.cost.toFixed(2)}, ${totals.requests} requests` : "no usage",
		shots === undefined ? "" : `${shots} screenshots, ${run.result.actions!.browser_runs} browser runs`,
	].filter(Boolean);
	return `<td><a href="${run.tag}/${run.name}.html">${escape(run.result.status)}</a>, ${escape(verdictText(run.judge?.verdict))}${lines.map((line) => `<small>${line}</small>`).join("")}</td>`;
}

function runPage(run: Run, bench: string, io: Io): string {
	const { result } = run;
	const task = result.task_dir ? `${run.dir}/${result.task_dir}` : undefined;
	const view = `${bench}/view/${run.tag}`;
	const link = (path: string) => relative(view, path);
	const totals = run.usage?.totals ?? {};
	const metrics = [
		["status", result.status],
		["judge", verdictText(run.judge?.verdict)],
		["cost", totals.cost === undefined ? "-" : `$${totals.cost.toFixed(2)}`],
		["requests", String(totals.requests ?? "-")],
		["output tokens", String(totals.output ?? "-")],
		["screenshots read", result.actions ? `${result.actions.screenshots_read.main} main, ${result.actions.screenshots_read.subagents} subagents` : "-"],
		["browser runs", String(result.actions?.browser_runs ?? "-")],
		["image", result.image ? `${result.image.ref} ${result.image.stamp ?? ""}` : "-"],
		["base, head", `${result.base ?? "-"}, ${result.head ?? "-"}`],
	];
	const passes = (run.judge?.passes ?? [])
		.map((pass, index) => `<h3>Pass ${index + 1}: ${escape(verdictText(pass.verdict ?? "error"))}</h3>${pass.error ? `<p>${escape(pass.error)}</p>` : ""}${pass.reasons ? `<p>${escape(pass.reasons)}</p>` : ""}${pass.fix ? `<p>Fix: ${escape(pass.fix)}</p>` : ""}${pass.rubric?.length ? `<table><tr><th>Rubric item</th><th>Met</th><th>Why</th></tr>${pass.rubric.map((item) => `<tr><td>${escape(item.item)}</td><td>${escape(item.met)}</td><td>${escape(item.why)}</td></tr>`).join("")}</table>` : ""}${pass.false_claims?.length ? `<p>False claims:</p><ul>${pass.false_claims.map((claim) => `<li>${escape(claim)}</li>`).join("")}</ul>` : ""}`)
		.join("");
	const browser = task ? collect(`${task}/browser`, "", io, []) : [];
	const reports = browser
		.filter((file) => file.path.endsWith(".md"))
		.map((file) => {
			const folder = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
			const html = (marked.parse(io.read(`${task}/browser/${file.path}`) ?? "") as string).replace(/src="(?![a-z]+:|\/)([^"]+)"/g, (_, src: string) => `src="${link(`${task}/browser/${folder ? `${folder}/` : ""}${src}`)}"`);
			return `<h3>${escape(file.path)}</h3><div class="report">${html}</div>`;
		})
		.join("");
	const frames = browser
		.filter((file) => /\.(png|jpe?g)$/i.test(file.path))
		.map((file) => `<figure><img src="${link(`${task}/browser/${file.path}`)}" loading="lazy" alt="${escape(file.path)}"><figcaption>${escape(file.path)}</figcaption></figure>`)
		.join("");
	const diff = result.diff ? (io.read(`${run.dir}/${result.diff}`) ?? "") : "";
	return page(
		`${result.task} ${run.tag} rep ${result.rep}`,
		`<p><a href="../index.html">All runs</a></p><h1>${escape(result.task)}, ${escape(run.tag)}, rep ${result.rep}</h1>
<table>${metrics.map(([name, value]) => `<tr><th>${name}</th><td>${escape(value)}</td></tr>`).join("")}</table>
${result.error ? `<h2>Error</h2><p>${escape(result.error)}</p>` : ""}
<h2>Judge</h2>${passes || "<p>Not judged yet: fleet bench judge writes it.</p>"}
<h2>Closing message</h2>${result.closing_message ? marked.parse(result.closing_message) : "<p>None.</p>"}
<h2>Browser reports</h2>${reports || "<p>No report.</p>"}
<h2>Frames</h2>${frames ? `<div class="frames">${frames}</div>` : "<p>No frames.</p>"}
<h2>Diff</h2>${diff ? `<details><summary>${diff.split("\n").length} lines</summary><pre>${escape(diff)}</pre></details>` : "<p>No diff.</p>"}
<h2>Files</h2><p><a href="${link(run.dir)}">Run directory</a></p>`,
	);
}

export function benchView(io: Io): string {
	const bench = `${io.home}/${FLEET.bench}`;
	const tags = io.list(`${bench}/runs`).sort();
	const runs: Run[] = tags.flatMap((tag) =>
		io.list(`${bench}/runs/${tag}`).flatMap((name) => {
			const dir = `${bench}/runs/${tag}/${name}`;
			const result = json<Result>(io, `${dir}/result.json`);
			if (!result) return [];
			return [{ tag, name, dir, result, usage: result.usage ? json(io, `${dir}/${result.usage}`) : undefined, judge: result.judge ? json<Judged>(io, `${dir}/${result.judge}`) : undefined }];
		}),
	);
	for (const tag of new Set(runs.map((run) => run.tag))) io.mkdir(`${bench}/view/${tag}`);
	for (const run of runs) io.write(`${bench}/view/${run.tag}/${run.name}.html`, runPage(run, bench, io));
	const keys = [...new Set(runs.map((run) => `${run.result.task}\0${run.result.rep}`))].sort();
	const rows = keys
		.map((key) => {
			const [task, rep] = key.split("\0");
			const control = json<Judged>(io, `${bench}/controls/${task}/judge.json`);
			const cells = tags.map((tag) => {
				const run = runs.find((one) => one.tag === tag && one.result.task === task && String(one.result.rep) === rep);
				return run ? cell(run) : "<td>-</td>";
			});
			return `<tr><td>${escape(task)} rep ${rep}<small>merged pull request: ${escape(verdictText(control?.verdict))}</small></td>${cells.join("")}</tr>`;
		})
		.join("\n");
	const index = `${bench}/view/index.html`;
	io.write(
		index,
		page(
			"Bench runs",
			`<h1>Bench runs</h1><p>Each cell: run status, the judge's verdict, cost and requests from usage.json, and the screenshots the agents read. The task column names the judge's verdict on the merged pull request, the positive control.</p>
<table><tr><th>Task</th>${tags.map((tag) => `<th>${escape(tag)}</th>`).join("\n")}</tr>
${rows}</table>`,
		),
	);
	return index;
}
