import { basename } from "node:path";
import { codexArgs } from "./codex.ts";
import { INSTALL_LOG, installScript } from "./deps.ts";
import { githubRef, linearServer } from "./github.ts";
import { memoryMiB, nodeHeapMiB } from "./heap.ts";
import type { Io } from "./io.ts";
import { agentName, sandboxName } from "./name.ts";
import { agentFor, fleetSandboxes, type Agent, type Sandbox } from "./status.ts";
import { parentDir, submodulePaths } from "./submodules.ts";

export type UpInput = { repo: string; label: string; branch?: string; memory?: string; root: string };
type Workspace = { workspace_id: string; label: string };
type Tab = { tab_id: string; label: string };
type Pane = { pane_id: string; tab_id: string; agent?: string | null };
type Created = { result: { workspace?: { workspace_id: string }; root_pane: { pane_id: string } } };

const DETECT_TIMEOUT_MS = 90_000;
const KNOWN_STATUS = new Set(["idle", "done", "working", "blocked"]);

export async function up(input: UpInput, io: Io): Promise<{ sandbox: string; agent: string; pane: string }> {
	const memory = input.memory ?? "8g";
	input = { ...input, repo: io.git(["rev-parse", "--show-toplevel"], input.repo) || input.repo };
	const sandbox = sandboxName(input.repo, input.label);
	const agent = agentName(sandbox);
	const origin = io.git(["remote", "get-url", "origin"], input.repo);
	const existing = fleetSandboxes(JSON.parse(io.sbx(["ls", "--json"], { quiet: true }))).find((s: Sandbox) => s.name === sandbox);
	if (!existing) {
		create(input, sandbox, origin, memory, io);
		try {
			seedSubmodules(io, input.repo, sandbox);
			if (input.branch) io.sbx(["exec", sandbox, "sh", "-c", `cd "$WORKSPACE_DIR" && (git switch "$1" 2>/dev/null || git switch -c "$1")`, "--", input.branch], { quiet: true });
		} catch (error) {
			io.sbx(["rm", "-f", sandbox], { quiet: true });
			throw new Error(`${sandbox}: setup failed and the container was removed\n${(error as Error).message}`);
		}
		io.sbx(["exec", sandbox, "sh", "-c", `setsid nohup bash -c "$1" >${INSTALL_LOG} 2>&1 </dev/null &`, "--", installScript], { quiet: true });
		io.log(`${sandbox}: created; dependencies install in the background, log ${INSTALL_LOG} in the container`);
	}

	const { pane, running } = openPane(io, basename(input.repo), agent);
	if (!running) io.herdr(["pane", "run", pane, `HERDR_AGENT=pi sbx run --name ${sandbox} -- --approve`]);
	await waitForAgent(io, pane);
	io.herdr(["agent", "rename", pane, agent]);
	io.log(`${sandbox}: pi waiting in tab ${agent} (pane ${pane}); no prompt sent`);
	return { sandbox, agent, pane };
}

function create(input: UpInput, sandbox: string, origin: string, memory: string, io: Io): void {
	const codex = codexArgs(io.read(`${io.home}/.pi/agent/auth.json`));
	try {
		io.sbx(["secret", "set", "github", "--sandbox", sandbox, "--ref", githubRef(origin)], { quiet: true });
	} catch (error) {
		io.log(`${sandbox}: no GitHub token bound (${(error as Error).message.split("\n")[0]}); git fetch inside will fail until \`sbx secret set github --sandbox ${sandbox} --ref '${githubRef(origin)}'\``);
	}
	const linear = linearServer(origin);
	io.sbx([
		"run", "-d", "--no-share-skills", "--name", sandbox, "--clone", "--memory", memory,
		"-e", "SSH_AUTH_SOCK_GATEWAY=",
		"--kit", `${input.root}/host/kits/no-ssh-agent`,
		"--kit-arg", `pi.codex_account=${codex.account}`,
		"--kit-arg", `pi.codex_sentinel=${codex.sentinel}`,
		"--kit-arg", `pi.node_heap_mb=${nodeHeapMiB(memory)}`,
		"--kit-arg", `pi.memory_mib=${memoryMiB(memory)}`,
		...(linear ? ["--static-mcp", linear] : []),
		`${input.root}/host/kits/pi`, input.repo, "--", "--approve",
	]);
}

function seedSubmodules(io: Io, repo: string, sandbox: string): void {
	const modules = submodulePaths(io.git(["submodule", "status"], repo));
	if (!modules.length) return;
	const workspace = io.sbx(["exec", sandbox, "sh", "-c", 'printf %s "$WORKSPACE_DIR"'], { quiet: true });
	for (const module of modules) {
		io.log(`${sandbox}: copying submodule ${module}`);
		io.sbx(["exec", sandbox, "sh", "-c", 'mkdir -p "$1" "$2"', "--", `${workspace}/${parentDir(module)}`, `${workspace}/.git/modules/${parentDir(module)}`], { quiet: true });
		io.sbx(["cp", `${repo}/${module}`, `${sandbox}:${workspace}/${parentDir(module)}/`], { quiet: true });
		io.sbx(["cp", `${repo}/.git/modules/${module}`, `${sandbox}:${workspace}/.git/modules/${parentDir(module)}/`], { quiet: true });
		io.sbx(["exec", sandbox, "sh", "-c", 'sudo chown -R agent:agent "$1" "$2" && rm -rf "$1/node_modules"', "--", `${workspace}/${module}`, `${workspace}/.git/modules/${module}`], { quiet: true });
	}
}

function openPane(io: Io, label: string, tab: string): { pane: string; running: boolean } {
	const named = agentFor(io.herdr<{ result: { agents: Agent[] } }>(["agent", "list"]).result.agents, tab);
	if (named?.pane_id) {
		if (named.agent !== "pi") throw new Error(`agent ${tab} is ${named.agent ?? "unknown"} in pane ${named.pane_id}, not pi; rename it or pick another label`);
		io.log(`${tab}: adopting the pi already running in pane ${named.pane_id}`);
		return { pane: named.pane_id, running: true };
	}
	const list = io.herdr<{ result: { workspaces: Workspace[] } }>(["workspace", "list"]);
	const workspace = list.result.workspaces.find((w) => w.label.toLowerCase() === label.toLowerCase())?.workspace_id;
	if (!workspace) {
		const created = io.herdr<Created>(["workspace", "create", "--label", label, "--no-focus"]);
		if (created.result.workspace) io.herdr(["tab", "rename", created.result.root_pane.pane_id.replace(/:p/, ":t"), tab]);
		return { pane: created.result.root_pane.pane_id, running: false };
	}
	const existing = io.herdr<{ result: { tabs: Tab[] } }>(["tab", "list", "--workspace", workspace]).result.tabs.find((t) => t.label === tab);
	if (existing) {
		const pane = io.herdr<{ result: { panes: Pane[] } }>(["pane", "list", "--workspace", workspace]).result.panes.find((p) => p.tab_id === existing.tab_id);
		if (!pane) throw new Error(`tab ${tab} exists without a pane; close it`);
		if (pane.agent && pane.agent !== "pi") throw new Error(`tab ${tab} already runs ${pane.agent} in pane ${pane.pane_id}`);
		if (pane.agent) io.log(`${tab}: adopting the pi already running in pane ${pane.pane_id}`);
		return { pane: pane.pane_id, running: Boolean(pane.agent) };
	}
	return { pane: io.herdr<Created>(["tab", "create", "--workspace", workspace, "--label", tab, "--no-focus"]).result.root_pane.pane_id, running: false };
}

async function waitForAgent(io: Io, pane: string): Promise<void> {
	const started = io.now().getTime();
	while (io.now().getTime() - started < DETECT_TIMEOUT_MS) {
		try {
			const status = io.herdr<{ result: { agent: Agent } }>(["agent", "get", pane]).result.agent.agent_status ?? "";
			if (KNOWN_STATUS.has(status)) return;
		} catch {}
		await io.sleep(2000);
	}
	throw new Error(`pi did not come up in pane ${pane} within ${DETECT_TIMEOUT_MS / 1000}s; read the pane`);
}
