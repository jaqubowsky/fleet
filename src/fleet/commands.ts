import type { Io } from "./io.ts";
import { render } from "../render/render.ts";
import { INSTALL_LOG } from "./deps.ts";
import { logEvent } from "./events.ts";
import { agentName } from "./name.ts";
import { artifactsDir, taskDir } from "./up.ts";
import { agentFor, checkoutProbe, elapsed, formatRows, parseCheckout, sandboxes, type Agent, type Row } from "./status.ts";
import { oneLine, parseEntries, summarize, type Summary } from "./usage.ts";

type Agents = { result: { agents: Agent[] } };

function agents(io: Io): Agent[] {
	return io.herdr<Agents>(["agent", "list"]).result.agents;
}

export function resolveSandbox(name: string, io: Io): string {
	const all = sandboxes(io);
	const hit = all.find((s) => s.name === name || agentName(s.name) === name);
	if (hit) return hit.name;

	throw new Error(`no fleet container named ${name}; running: ${all.map((s) => s.name).join(", ") || "none"}`);
}

export function ls(io: Io): string {
	const live = agents(io);
	const rows: Row[] = sandboxes(io).map((s) => {
		const checkout = s.status === "running" ? parseCheckout(io.sbx(["exec", s.name, "sh", "-c", checkoutProbe], { quiet: true })) : { branch: "?", dirty: 0, head: "" };
		const repo = s.workspaces[0];
		const usage = repo ? sessionUsage(taskDir(repo, s.name, io), io) : undefined;
		const started = usage?.runs[0]?.started_at;
		return {
			sandbox: s.name,
			status: s.status,
			agent: agentFor(live, agentName(s.name))?.agent_status ?? "gone",
			branch: checkout.branch,
			dirty: checkout.dirty,
			age: started ? elapsed(new Date(started), io.now()) : undefined,
			cost: usage ? `$${usage.totals.cost.toFixed(2)}` : undefined,
		};
	});
	return formatRows(rows);
}

export function peek(sandbox: string, io: Io, lines = 40): string {
	const git = io.sbx(["exec", sandbox, "sh", "-c", `cd "$WORKSPACE_DIR" && git status --short && echo --- && git log --oneline -8 && echo --- && git diff --stat HEAD && echo --- && (tail -3 ${INSTALL_LOG} 2>/dev/null || echo "deps: no install log")`], { quiet: true });
	let tail = "";
	try {
		tail = io.herdrText(["agent", "read", agentName(sandbox), "--source", "recent-unwrapped", "--lines", String(lines)]);
	} catch {
		tail = `(no herdr agent named ${agentName(sandbox)}; the tab may still be coming up)`;
	}
	return `${git}\n=== last ${lines} lines\n${tail}`;
}

export function steer(sandbox: string, text: string, io: Io): void {
	const agent = agentName(sandbox);
	logEvent(io, "steer", agent, text);
	io.herdr(["agent", "prompt", agent, text]);
	io.log(`${agent}: steered`);
}

const SHELL_SYNTAX = /[\s;&|<>$`(){}[\]*?~]/;

export function execScript(command: string[]): string {
	return command.length === 1 && SHELL_SYNTAX.test(command[0]) ? command[0] : 'exec "$@"';
}

export function exec(sandbox: string, command: string[], io: Io): void {
	const toolchain = '{ [ -r /etc/fnm-bash-env.sh ] && . /etc/fnm-bash-env.sh; } >/dev/null 2>&1 || true';
	io.sbx(["exec", sandbox, "sh", "-c", `cd "$WORKSPACE_DIR" && ${toolchain}; ${execScript(command)}`, "--", ...command], { stream: true });
}

export function renderHost(root: string, io: Io): void {
	render({ root, harness: io.harness, seat: "host", out: `${io.home}/${io.harness.home}` }, io);
}

export function build(root: string, io: Io): void {
	const stage = `${io.tmp}/${io.harness.name}-sbx-stage-${io.now().getTime()}`;
	render({ root, harness: io.harness, seat: "container", out: stage }, io);
	io.run(`${root}/sbx/build.sh`, [io.harness.name, io.harness.image, stage]);
}

export function copy(from: string, to: string, io: Io): void {
	io.sbx(["cp", from, to]);
}

type Artifact = { path: string; size: number; mtime: Date };

function collect(root: string, rel: string, io: Io, found: Artifact[]): Artifact[] {
	for (const name of io.list(rel ? `${root}/${rel}` : root)) {
		const path = rel ? `${rel}/${name}` : name;
		const info = io.stat(`${root}/${path}`);
		if (!info) continue;
		if (info.dir) collect(root, path, io, found);
		else found.push({ path, size: info.size, mtime: info.mtime });
	}

	return found;
}

function bytes(size: number): string {
	if (size < 1024) return `${size}B`;
	if (size < 1048576) return `${Math.round(size / 1024)}K`;
	return `${(size / 1048576).toFixed(1)}M`;
}

function age(mtime: Date, io: Io): string {
	const minutes = Math.round((io.now().getTime() - mtime.getTime()) / 60000);
	if (minutes < 60) return `${minutes}m ago`;
	if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
	return `${Math.round(minutes / 1440)}d ago`;
}

type Line = { indent: string; name: string; detail: string };

function entries(dir: string, io: Io): { files: Artifact[]; dirs: string[] } {
	const files: Artifact[] = [];
	const dirs: string[] = [];
	for (const name of io.list(dir)) {
		const info = io.stat(`${dir}/${name}`);
		if (!info) continue;
		if (info.dir) dirs.push(name);
		else files.push({ path: name, size: info.size, mtime: info.mtime });
	}
	files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
	dirs.sort();
	return { files, dirs };
}

function fileLine(indent: string, f: Artifact, io: Io): Line {
	return { indent, name: f.path, detail: `${bytes(f.size).padStart(6)}  ${age(f.mtime, io)}` };
}

function folderLine(indent: string, dir: string, name: string, io: Io): Line {
	const inside = collect(`${dir}/${name}`, "", io, []);
	return { indent, name: `${name}/`, detail: `${inside.length} files  ${bytes(inside.reduce((sum, f) => sum + f.size, 0))}` };
}

function isTask(dir: string, io: Io): boolean {
	return io.stat(`${dir}/status.md`) !== undefined;
}

export function artifacts(repo: string, io: Io): string {
	const root = artifactsDir(repo, io);
	const top = entries(root, io);
	const tasks = top.dirs.filter((d) => isTask(`${root}/${d}`, io));
	const lines: Line[] = [];
	for (const task of tasks) {
		lines.push({ indent: "", name: `${task}/`, detail: "" });
		const inside = entries(`${root}/${task}`, io);
		lines.push(...inside.files.map((f) => fileLine("  ", f, io)), ...inside.dirs.map((d) => folderLine("  ", `${root}/${task}`, d, io)));
	}
	lines.push(...top.dirs.filter((d) => !tasks.includes(d)).map((d) => folderLine("", root, d, io)), ...top.files.map((f) => fileLine("", f, io)));
	if (!lines.length) return `${root}\nnothing left here yet`;

	const width = Math.max(...lines.map((l) => l.name.length));

	return [root, ...lines.map((l) => (l.detail ? `${l.indent}${l.name.padEnd(width)}  ${l.detail}` : `${l.indent}${l.name}`))].join("\n");
}

function sessionUsage(task: string, io: Io, branch?: string, repo?: string): Summary | undefined {
	const files = collect(`${task}/logs/sessions`, "", io, []).filter((f) => f.path.endsWith(".jsonl") && !f.path.includes("subagent-artifacts/"));
	if (!files.length) return undefined;
	const firstAt = (session: ReturnType<typeof parseEntries>) => session.find((e) => e.timestamp)?.timestamp ?? "";
	const entries = files
		.map((f) => parseEntries(io.read(`${task}/logs/sessions/${f.path}`) ?? ""))
		.sort((a, b) => firstAt(a).localeCompare(firstAt(b)))
		.flat();
	const first = entries.find((e) => e.type === "message" && e.message?.role === "assistant")?.timestamp;
	const commits = repo && first && branch
		? io.git(["log", "--format=%h\t%cI", `--since=${first}`, branch], repo).split("\n").filter(Boolean).map((line) => {
				const [sha, at] = line.split("\t");
				return { sha, at };
			})
		: [];
	return summarize(entries, commits);
}

function landed(head: string, repo: string | undefined, io: Io): boolean {
	if (!head || !repo) return true;
	try {
		io.git(["cat-file", "-e", `${head}^{commit}`], repo);
		return true;
	} catch {
		return false;
	}
}

function harvest(sandbox: string, task: string, from: string, force: boolean, io: Io): void {
	const to = `${task}/logs/sessions/${from.split("/").pop()}`;
	try {
		io.sbx(["cp", `${sandbox}:${from}`, to], { quiet: true });
		io.log(`${sandbox}: transcripts -> ${to}`);
	} catch (error) {
		if (!force) throw new Error(`${sandbox}: transcripts in ${from} did not copy out, so the container stays; pass --force to remove it without them\n${(error as Error).message}`);
		io.log(`${sandbox}: transcripts in ${from} did not copy out; removing anyway (--force)`);
	}
}

export function down(sandbox: string, opts: { force?: boolean }, io: Io): void {
	const entry = sandboxes(io).find((s) => s.name === sandbox);
	if (!entry) throw new Error(`no fleet container named ${sandbox}`);
	const checkout = parseCheckout(io.sbx(["exec", sandbox, "sh", "-c", checkoutProbe], { quiet: true }));
	if (checkout.dirty && !opts.force) {
		throw new Error(`${sandbox} has ${checkout.dirty} uncommitted file(s) on ${checkout.branch}; commit them in the container or pass --force to discard`);
	}
	if (!landed(checkout.head, entry.workspaces[0], io) && !opts.force) {
		throw new Error(`${sandbox} has commits on ${checkout.branch} that never reached ${entry.workspaces[0]}; run ${io.harness.cli} land first or pass --force to discard`);
	}
	const repo = entry.workspaces[0];
	const task = taskDir(repo ?? "", sandbox, io);
	if (io.harness.containerSessions) harvest(sandbox, task, io.harness.containerSessions, opts.force === true, io);
	const summary = sessionUsage(task, io, checkout.branch, repo);
	if (summary) {
		io.write(`${task}/logs/usage.json`, `${JSON.stringify(summary, null, 2)}\n`);
		io.log(`${sandbox}: usage ${oneLine(summary)} -> ${task}/logs/usage.json`);
	} else {
		io.log(`${sandbox}: no session in ${task}/logs/sessions (${io.harness.agent} never ran)`);
	}
	if (repo && io.list(artifactsDir(repo, io)).length) io.log(`${sandbox}: artifacts stay in ${task}, read them with ${io.harness.cli} artifacts --repo ${repo}`);
	const agent = agentFor(agents(io), agentName(sandbox));
	if (agent?.tab_id) io.herdr(["tab", "close", agent.tab_id]);
	try {
		io.sbx(["rm", "-f", sandbox], { quiet: true });
	} catch (error) {
		if (sandboxes(io).some((s) => s.name === sandbox)) throw error;
		io.log(`${sandbox}: removed, but sbx reported: ${(error as Error).message.split("\n").slice(1).join(" ")}`);
		return;
	}
	io.log(`${sandbox}: removed`);
}
