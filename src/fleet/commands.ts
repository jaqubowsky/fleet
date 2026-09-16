import type { Io } from "./io.ts";
import { INSTALL_LOG } from "./deps.ts";
import { agentName } from "./name.ts";
import { agentFor, checkoutProbe, fleetSandboxes, formatRows, parseCheckout, type Agent, type Row, type Sandbox } from "./status.ts";

type Agents = { result: { agents: Agent[] } };

function agents(io: Io): Agent[] {
	return io.herdr<Agents>(["agent", "list"]).result.agents;
}

function sandboxes(io: Io): Sandbox[] {
	return fleetSandboxes(JSON.parse(io.sbx(["ls", "--json"], { quiet: true })));
}

export function resolveSandbox(name: string, io: Io): string {
	return sandboxes(io).find((s) => s.name === name || agentName(s.name) === name)?.name ?? name;
}

export function ls(io: Io): string {
	const live = agents(io);
	const rows: Row[] = sandboxes(io).map((s) => {
		const checkout = s.status === "running" ? parseCheckout(io.sbx(["exec", s.name, "sh", "-c", checkoutProbe], { quiet: true })) : { branch: "?", dirty: 0, head: "" };
		return { sandbox: s.name, status: s.status, agent: agentFor(live, agentName(s.name))?.agent_status ?? "gone", branch: checkout.branch, dirty: checkout.dirty };
	});
	return formatRows(rows);
}

export function peek(sandbox: string, io: Io, lines = 40): string {
	const git = io.sbx(["exec", sandbox, "sh", "-c", `cd "$WORKSPACE_DIR" && git status --short && echo --- && git log --oneline -8 && echo --- && git diff --stat HEAD && echo --- && (tail -3 ${INSTALL_LOG} 2>/dev/null || echo "deps: no install log")`], { quiet: true });
	let tail = "";
	try {
		tail = io.herdrText(["agent", "read", agentName(sandbox), "--source", "recent-unwrapped", "--lines", String(lines)]);
	} catch {
		tail = "(no agent in a pane)";
	}
	return `${git}\n=== last ${lines} lines\n${tail}`;
}

export function say(sandbox: string, text: string, io: Io): void {
	const agent = agentName(sandbox);
	io.append(`${io.home}/.pi/agent/fleet-say.log`, `${io.now().toISOString()} ${agent} ${JSON.stringify(text)}`);
	io.herdr(["agent", "prompt", agent, text]);
	io.log(`${agent}: prompt sent`);
}

const SHELL_SYNTAX = /[\s;&|<>$`(){}[\]*?~]/;

export function execScript(command: string[]): string {
	return command.length === 1 && SHELL_SYNTAX.test(command[0]) ? command[0] : 'exec "$@"';
}

export function exec(sandbox: string, command: string[], io: Io): void {
	io.sbx(["exec", sandbox, "sh", "-c", `cd "$WORKSPACE_DIR" && ${execScript(command)}`, "--", ...command]);
}

export function build(root: string, io: Io): void {
	io.run(`${root}/sbx/build.sh`, []);
}

export function copy(from: string, to: string, io: Io): void {
	io.sbx(["cp", from, to]);
}

type Artifact = { path: string; size: number; mtime: Date };

export function artifactsDir(sandbox: string, io: Io): string {
	return `${io.home}/.pi/artifacts/${sandbox}`;
}

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

export function artifacts(sandbox: string, io: Io): string {
	const root = artifactsDir(sandbox, io);
	const found = collect(root, "", io, []).sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
	if (!found.length) return `${root}\nnothing left here yet`;

	const width = Math.max(...found.map((f) => f.path.length));

	return [root, ...found.map((f) => `${f.path.padEnd(width)}  ${bytes(f.size).padStart(6)}  ${age(f.mtime, io)}`)].join("\n");
}

function harvest(sandbox: string, io: Io): string | undefined {
	const stamp = io.now().toISOString().replace(/[-:]/g, "").slice(0, 15);
	const dest = `${io.home}/.pi/sandbox-transcripts/${sandbox}-${stamp}`;
	io.mkdir(`${io.home}/.pi/sandbox-transcripts`);
	try {
		io.sbx(["cp", `${sandbox}:/home/agent/.pi/agent/sessions`, dest], { quiet: true });
	} catch (error) {
		if (!/not found/.test((error as Error).message)) throw error;
		return undefined;
	}
	return dest;
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

export function down(sandbox: string, opts: { force?: boolean }, io: Io): void {
	const entry = sandboxes(io).find((s) => s.name === sandbox);
	if (!entry) throw new Error(`no fleet container named ${sandbox}`);
	const checkout = parseCheckout(io.sbx(["exec", sandbox, "sh", "-c", checkoutProbe], { quiet: true }));
	if (checkout.dirty && !opts.force) {
		throw new Error(`${sandbox} has ${checkout.dirty} uncommitted file(s) on ${checkout.branch}; commit them in the container or pass --force to discard`);
	}
	if (!landed(checkout.head, entry.workspaces[0], io) && !opts.force) {
		throw new Error(`${sandbox} has commits on ${checkout.branch} that never reached ${entry.workspaces[0]}; run fleet land first or pass --force to discard`);
	}
	const dest = harvest(sandbox, io);
	io.log(dest ? `${sandbox}: transcripts -> ${dest}` : `${sandbox}: no transcripts (pi never ran a session)`);
	if (io.list(artifactsDir(sandbox, io)).length) io.log(`${sandbox}: artifacts stay in ${artifactsDir(sandbox, io)}, read them with fleet artifacts ${sandbox}`);
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
