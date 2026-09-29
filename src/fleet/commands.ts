import { CLI, CONTINUE, KINDS, type AgentName } from "../harness.ts";
import { type Io, seatOf } from "./io.ts";
import { STOPPED } from "../../extensions/handoff-on-error.ts";
import { COMPLETE } from "../../extensions/session-handoff.ts";
import { ACTIVITY, changes, fieldsOf, STATUS_LOG } from "../../extensions/status-history.ts";
import { activityOf, callsSince, projection } from "./activity.ts";
import { render } from "../render/render.ts";
import { INSTALL_LOG } from "./deps.ts";
import { logEvent } from "./events.ts";
import { idleStalled, TERMINAL } from "./monitor.ts";
import { agentName } from "./name.ts";
import { artifactsDir, harnessStamp, imageStampPath, staleImage, taskDir } from "./up.ts";
import {
	agentFor,
	branchFacts,
	checkoutProbe,
	formatRows,
	parseCheckout,
	sandboxes,
	type Agent,
	type Row,
	type Sandbox,
} from "./status.ts";
import { oneLine, parseEntries, summarize, type Summary } from "./usage.ts";

type Agents = { result: { agents: Agent[] } };

function agents(io: Io): Agent[] {
	return io.herdr<Agents>(["agent", "list"]).result.agents;
}

export function resolveSandbox(name: string, io: Io): Sandbox {
	const all = sandboxes(io);
	const hit = all.find((s) => s.name === name || agentName(s.name) === name);
	if (hit) return hit;

	throw new Error(
		`no fleet container named ${name}; running: ${all.map((s) => s.name).join(", ") || "none"}`,
	);
}

const CONTAINER_USAGE = "/home/agent/fleet/src/fleet/usage.ts";

export function activityNow(sandbox: Sandbox, task: string, io: Io): string {
	return projection(activityOf(io.read(`${task}/${ACTIVITY}`)), costSoFar(sandbox, task, io), io.now());
}

const justAfter = (at: string) => new Date(Date.parse(at) + 1);

export function blockedWork(task: string, io: Io): number {
	const { status, attention } = fieldsOf(io.read(`${task}/status.md`));
	if (status !== "blocked" || attention?.startsWith(STOPPED)) return 0;
	let from: string | undefined;
	for (const change of changes(io.read(`${task}/${STATUS_LOG}`)).reverse()) {
		if (change.status !== "blocked") break;
		from = change.at;
	}
	return from ? callsSince(io.read(`${task}/${ACTIVITY}`), justAfter(from)) : 0;
}

function costSoFar(sandbox: Sandbox, task: string, io: Io): number | undefined {
	const sessions = sandbox.kind.containerSessions;
	if (!sessions) return sessionUsage(task, io)?.totals.cost;
	try {
		const printed = io.sbx(["exec", sandbox.name, "node", CONTAINER_USAGE, sessions], { quiet: true });
		return printed ? Number(printed) : undefined;
	} catch {
		return undefined;
	}
}

export function ls(io: Io): string {
	const live = agents(io);
	const rows: Row[] = sandboxes(io).map((s) => {
		const agent = agentFor(live, agentName(s.name))?.agent_status ?? "gone";
		let checkout = { branch: "?", dirty: 0, head: "" };
		try {
			if (s.status === "running") checkout = parseCheckout(io.sbx(["exec", s.name, "sh", "-c", checkoutProbe], { quiet: true }));
		} catch (error) {
			return { sandbox: s.name, status: "failed", agent, branch: "?", dirty: 0, facts: lastLine(error) };
		}
		const running = s.status === "running";
		const repo = s.workspaces[0];
		const task = repo ? taskDir(repo, s.name, io) : undefined;
		const last = task ? activityOf(io.read(`${task}/${ACTIVITY}`))?.last : undefined;
		const facts = running && repo ? branchFacts(io, s.name, repo) : undefined;
		return {
			sandbox: s.name,
			status: s.status,
			agent,
			branch: checkout.branch,
			dirty: checkout.dirty,
			blocked: task ? blockedWork(task, io) : 0,
			stalled: !facts?.running && !!last && idleStalled(agent, fieldsOf(io.read(`${task}/status.md`)).status, io.now().getTime() - new Date(last).getTime()),
			activity: task && (running || !s.kind.containerSessions) ? activityNow(s, task, io) : undefined,
			facts: facts && `commits ${facts.commits}; pr ${facts.pr}`,
		};
	});
	return formatRows(rows);
}

function lastLine(error: unknown): string {
	return (error instanceof Error ? error.message : String(error)).trim().split("\n").at(-1) ?? "";
}

export function peek(sandbox: string, io: Io, lines = 40): string {
	const git = io.sbx(
		[
			"exec",
			sandbox,
			"sh",
			"-c",
			`cd "$WORKSPACE_DIR" && git status --short && echo --- && git log --oneline -8 && echo --- && git diff --stat HEAD && echo --- && (tail -3 ${INSTALL_LOG} 2>/dev/null || echo "deps: no install log")`,
		],
		{ quiet: true },
	);
	let tail = "";
	try {
		tail = io.herdrText([
			"agent",
			"read",
			agentName(sandbox),
			"--source",
			"recent-unwrapped",
			"--lines",
			String(lines),
		]);
	} catch {
		tail = `(no herdr agent named ${agentName(sandbox)}; the tab may still be coming up)`;
	}
	return `${git}\n=== last ${lines} lines\n${tail}`;
}

export function steer(sandbox: Sandbox, text: string, io: Io, root?: string): void {
	prompt(sandbox, text, io, { root });
}

const IDLE_TIMEOUT_MS = 60_000;

export async function handoff(sandbox: Sandbox, io: Io, options: { continue?: boolean; root?: string } = {}): Promise<void> {
	const command = sandbox.kind.tokens["handoff.command"];
	if (sandbox.kind.handoffTakesText) return prompt(sandbox, options.continue ? `${command} ${CONTINUE}` : command, io, { root: options.root, reset: true });
	prompt(sandbox, command, io, { root: options.root, reset: true });
	if (!options.continue) return;
	await idle(sandbox.name, io);
	prompt(sandbox, CONTINUE, io);
}

async function idle(sandbox: string, io: Io): Promise<void> {
	const started = io.now().getTime();
	while (io.now().getTime() - started < IDLE_TIMEOUT_MS) {
		if (TERMINAL.has(agentFor(agents(io), agentName(sandbox))?.agent_status ?? "")) return;
		await io.sleep(1000);
	}
	throw new Error(`${sandbox}: the fresh session did not report idle within ${IDLE_TIMEOUT_MS / 1000}s, so the continue was not sent. Inspect ${CLI} peek ${sandbox}, then steer the continue yourself.`);
}

function prompt({ name: sandbox, kind, workspaces }: Sandbox, text: string, io: Io, { root, reset }: { root?: string; reset?: boolean } = {}): void {
	seatOf(io);
	const agent = agentName(sandbox);
	const stale = root ? staleImage(root, kind, io) : undefined;
	if (stale) io.log(`${stale}; ${sandbox} keeps its image until it goes down and up again, so do that at its next natural break`);
	logEvent(io, "steer", agent, text);
	const handoff = reset && workspaces[0] ? statusOf(workspaces[0], sandbox, io) : undefined;
	const before = handoff?.();
	try {
		io.herdr([
			"agent",
			"prompt",
			agent,
			text,
			"--wait",
			"--until",
			"working",
			"--timeout",
			"6000",
		]);
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!error.message.includes("agent_prompt_stalled")
		)
			throw error;
		if (!handoff)
			throw new Error(
				`agent_prompt_stalled: Prompt submission uncertain. Inspect ${CLI} peek ${sandbox} and the agent editor; do not steer again until you know whether the prompt was submitted.`,
				{ cause: error },
			);
	}
	if (handoff && (before === COMPLETE || handoff() !== COMPLETE))
		throw new Error(
			`${text} sent, and status.md shows no context reset. Inspect ${CLI} peek ${sandbox}; do not steer again until you know whether the session was cleared.`,
		);
	io.log(`${agent}: steered`);
}

function statusOf(repo: string, sandbox: string, io: Io): () => string | undefined {
	return () => fieldsOf(io.read(`${taskDir(repo, sandbox, io)}/status.md`)).attention;
}

const SHELL_SYNTAX = /[\s;&|<>$`(){}[\]*?~]/;

export function execScript(command: string[]): string {
	return command.length === 1 && SHELL_SYNTAX.test(command[0])
		? command[0]
		: 'exec "$@"';
}

export function exec(sandbox: string, command: string[], io: Io): void {
	const toolchain =
		"{ [ -r /etc/fnm-bash-env.sh ] && . /etc/fnm-bash-env.sh; } >/dev/null 2>&1 || true";
	io.sbx(
		[
			"exec",
			sandbox,
			"sh",
			"-c",
			`cd "$WORKSPACE_DIR" && ${toolchain}; ${execScript(command)}`,
			"--",
			...command,
		],
		{ stream: true },
	);
}

export function renderHost(root: string, io: Io): void {
	const { name } = seatOf(io);
	render({ root, agent: name, seat: "host", out: `${io.home}/${KINDS[name].home}` }, io);
}

export function build(root: string, name: AgentName | undefined, io: Io): void {
	const kind = KINDS[name ?? seatOf(io).name];
	const stage = `${io.tmp}/${kind.name}-sbx-stage-${io.now().getTime()}`;
	render({ root, agent: kind.name, seat: "container", out: stage }, io);
	const stamp = harnessStamp(root, kind, io);
	io.run(`${root}/sbx/build.sh`, [kind.name, kind.image, stage]);
	io.mkdir(`${io.home}/${kind.home}/${kind.cache}`);
	io.write(imageStampPath(kind, io), `${stamp}\n`);
}

export function copy(from: string, to: string, io: Io): void {
	io.sbx(["cp", from, to]);
}

type Artifact = { path: string; size: number; mtime: Date };

function collect(
	root: string,
	rel: string,
	io: Io,
	found: Artifact[],
): Artifact[] {
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
	return {
		indent,
		name: f.path,
		detail: `${bytes(f.size).padStart(6)}  ${age(f.mtime, io)}`,
	};
}

function folderLine(indent: string, dir: string, name: string, io: Io): Line {
	const inside = collect(`${dir}/${name}`, "", io, []);
	return {
		indent,
		name: `${name}/`,
		detail: `${inside.length} files  ${bytes(inside.reduce((sum, f) => sum + f.size, 0))}`,
	};
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
		lines.push(
			...inside.files.map((f) => fileLine("  ", f, io)),
			...inside.dirs.map((d) => folderLine("  ", `${root}/${task}`, d, io)),
		);
	}
	lines.push(
		...top.dirs
			.filter((d) => !tasks.includes(d))
			.map((d) => folderLine("", root, d, io)),
		...top.files.map((f) => fileLine("", f, io)),
	);
	if (!lines.length) return `${root}\nnothing left here yet`;

	const width = Math.max(...lines.map((l) => l.name.length));

	return [
		root,
		...lines.map((l) =>
			l.detail
				? `${l.indent}${l.name.padEnd(width)}  ${l.detail}`
				: `${l.indent}${l.name}`,
		),
	].join("\n");
}

const two = (n: number) => String(n).padStart(2, "0");

function localTime(iso: string): string {
	const at = new Date(iso);
	return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`;
}

export function history(sandbox: string, repo: string, io: Io): string {
	const running = sandboxes(io).find(
		(s) => s.name === sandbox || agentName(s.name) === sandbox,
	);
	const file = `${taskDir(running?.workspaces[0] ?? repo, running?.name ?? sandbox, io)}/${STATUS_LOG}`;
	const kept = changes(io.read(file));
	if (!kept.length)
		return `${file}: no changes yet; the container adds a line each time status.md changes`;
	const out: string[] = [];
	let before: Record<string, string | undefined> = { attention: "none" };
	kept.forEach((change, index) => {
		const now = {
			status: change.status,
			attention: change.attention,
			summary: change.summary?.replace(/\s+/g, " "),
		};
		out.push(
			`${String(index + 1).padStart(3, "0")}  ${localTime(change.at)}  ${before.status && before.status !== now.status ? `${before.status} -> ` : ""}${now.status ?? "not recorded"}`,
		);
		for (const name of ["attention", "summary"] as const)
			if (now[name] && now[name] !== before[name])
				out.push(`     ${name}: ${now[name]}`);
		for (const line of change.added) out.push(`     + ${line.slice(2)}`);
		for (const line of change.removed) out.push(`     removed: ${line.slice(2)}`);
		before = now;
	});
	return out.join("\n");
}

function sessionUsage(
	task: string,
	io: Io,
	branch?: string,
	repo?: string,
): Summary | undefined {
	const files = collect(`${task}/logs/sessions`, "", io, []).filter(
		(f) => f.path.endsWith(".jsonl") && !f.path.includes("subagent-artifacts/"),
	);
	if (!files.length) return undefined;
	const firstAt = (session: ReturnType<typeof parseEntries>) =>
		session.find((e) => e.timestamp)?.timestamp ?? "";
	const entries = files
		.map((f) => parseEntries(io.read(`${task}/logs/sessions/${f.path}`) ?? ""))
		.sort((a, b) => firstAt(a).localeCompare(firstAt(b)))
		.flat();
	const first = entries.find(
		(e) => e.type === "message" && e.message?.role === "assistant",
	)?.timestamp;
	const commits =
		repo && first && branch && hasBranch(branch, repo, io)
			? io
					.git(["log", "--format=%h\t%cI", `--since=${first}`, branch], repo)
					.split("\n")
					.filter(Boolean)
					.map((line) => {
						const [sha, at] = line.split("\t");
						return { sha, at };
					})
			: [];
	return summarize(entries, commits);
}

function hasBranch(branch: string, repo: string, io: Io): boolean {
	try {
		io.git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repo);
		return true;
	} catch {
		return false;
	}
}

function landed(sandbox: string, head: string, repo: string | undefined, io: Io): boolean {
	if (!head || !repo) return true;
	try {
		io.git(["cat-file", "-e", `${head}^{commit}`], repo);
		return true;
	} catch {
		return pushed(sandbox, head, io);
	}
}

function pushed(sandbox: string, head: string, io: Io): boolean {
	return io
		.sbx(["exec", sandbox, "sh", "-c", `cd "$WORKSPACE_DIR" && git for-each-ref --contains ${head} --format='%(refname)' refs/remotes`], { quiet: true })
		.trim() !== "";
}

function harvest(
	sandbox: string,
	task: string,
	from: string,
	force: boolean,
	io: Io,
): void {
	const to = `${task}/logs/sessions/${from.split("/").pop()}`;
	try {
		io.sbx(["cp", `${sandbox}:${from}`, to], { quiet: true });
		io.log(`${sandbox}: transcripts -> ${to}`);
	} catch (error) {
		if (!force)
			throw new Error(
				`${sandbox}: transcripts in ${from} did not copy out, so the container stays; pass --force to remove it without them\n${(error as Error).message}`,
			);
		io.log(
			`${sandbox}: transcripts in ${from} did not copy out; removing anyway (--force)`,
		);
	}
}

const GUEST_CGROUP = "/sys/fs/cgroup/docker";
const GUEST_MEMORY_FILES = ["memory.peak", "memory.stat", "memory.events"].map((f) => `${GUEST_CGROUP}/${f}`);

function recordMemory(sandbox: string, task: string, io: Io): void {
	let printed: string;
	try {
		printed = io.sbx(["exec", sandbox, "cat", ...GUEST_MEMORY_FILES], { quiet: true }).trim();
	} catch (error) {
		io.log(`${sandbox}: no memory recorded: ${(error as Error).message.split("\n").slice(1).join(" ")}`);
		return;
	}
	const [peak, ...counters] = printed.split("\n");
	const counter = new Map(counters.map((line) => line.split(" ") as [string, string]));
	const memory = {
		peakBytes: peak ? Number(peak) : Number.NaN,
		anonBytes: Number(counter.get("anon")),
		high: Number(counter.get("high")),
		oom: Number(counter.get("oom")),
	};
	const unreadable = Object.entries(memory).filter(([, value]) => !Number.isInteger(value)).map(([key]) => key);
	if (unreadable.length) {
		io.log(`${sandbox}: no memory recorded: ${unreadable.join(", ")} unreadable in ${GUEST_CGROUP}`);
		return;
	}
	io.write(`${task}/logs/memory.json`, `${JSON.stringify(memory)}\n`);
	io.log(`${sandbox}: memory peak ${(memory.peakBytes / 2 ** 30).toFixed(1)} GiB -> ${task}/logs/memory.json`);
}

export function down(sandbox: string, opts: { force?: boolean }, io: Io): void {
	const entry = sandboxes(io).find((s) => s.name === sandbox);
	if (!entry) throw new Error(`no fleet container named ${sandbox}`);
	const checkout = parseCheckout(
		io.sbx(["exec", sandbox, "sh", "-c", checkoutProbe], { quiet: true }),
	);
	if (checkout.dirty && !opts.force) {
		throw new Error(
			`${sandbox} has ${checkout.dirty} uncommitted file(s) on ${checkout.branch}; commit them in the container or pass --force to discard`,
		);
	}
	if (!landed(sandbox, checkout.head, entry.workspaces[0], io) && !opts.force) {
		throw new Error(
			`${sandbox} has commits on ${checkout.branch} that never reached ${entry.workspaces[0]}; run ${CLI} land first or pass --force to discard`,
		);
	}
	logEvent(io, "down", agentName(sandbox));
	const repo = entry.workspaces[0];
	const task = taskDir(repo ?? "", sandbox, io);
	if (entry.kind.containerSessions)
		harvest(sandbox, task, entry.kind.containerSessions, opts.force === true, io);
	const summary = sessionUsage(task, io, checkout.branch, repo);
	if (summary) {
		io.write(`${task}/logs/usage.json`, `${JSON.stringify(summary, null, 2)}\n`);
		io.log(`${sandbox}: usage ${oneLine(summary)} -> ${task}/logs/usage.json`);
	} else {
		io.log(
			`${sandbox}: no session in ${task}/logs/sessions (the container's agent never ran)`,
		);
	}
	recordMemory(sandbox, task, io);
	if (repo && io.list(artifactsDir(repo, io)).length)
		io.log(
			`${sandbox}: artifacts stay in ${task}, read them with ${CLI} artifacts --repo ${repo}`,
		);
	const agent = agentFor(agents(io), agentName(sandbox));
	if (agent?.tab_id) io.herdr(["tab", "close", agent.tab_id]);
	try {
		io.sbx(["rm", "-f", sandbox], { quiet: true });
	} catch (error) {
		if (sandboxes(io).some((s) => s.name === sandbox)) throw error;
		io.log(
			`${sandbox}: removed, but sbx reported: ${(error as Error).message.split("\n").slice(1).join(" ")}`,
		);
		return;
	}
	io.log(`${sandbox}: removed`);
}
