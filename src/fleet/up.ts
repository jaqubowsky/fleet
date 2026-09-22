import { basename } from "node:path";
import { codexArgs } from "./codex.ts";
import { INSTALL_LOG, installScript } from "./deps.ts";
import { logEvent } from "./events.ts";
import { githubRef, linearServer } from "./github.ts";
import type { Io } from "./io.ts";
import { baseBranch } from "./land.ts";
import { agentName, sandboxName } from "./name.ts";
import {
	agentFor,
	fleetSandboxes,
	type Agent,
	type Sandbox,
} from "./status.ts";
import { gitdirOf, parentDir, submodulePaths } from "./submodules.ts";

export function artifactsDir(repo: string, io: Io): string {
	return `${io.home}/.sandboxes/${basename(repo)}`;
}

export function taskDir(repo: string, sandbox: string, io: Io): string {
	return `${artifactsDir(repo, io)}/${sandbox}`;
}

const TASK_STATUS = "status: new\nattention: none\n\n## Plan\n- [ ] \n";

function layoutTask(dir: string, io: Io): void {
	io.mkdir(`${dir}/logs/sessions`);
	if (io.read(`${dir}/status.md`) === undefined) io.write(`${dir}/status.md`, TASK_STATUS);
}

export function piArgs(model: string | undefined, resume: boolean): string {
	return `${model ? ` --model ${model}` : ""}${resume ? " -c" : ""}`;
}

export const BRANCH_FROM_BASE =
	'cd "$WORKSPACE_DIR" && (git fetch --quiet origin "$2" || echo "fleet: fetch of $2 failed, branching from the local base") && (git switch "$1" 2>/dev/null || git switch -c "$1" "$(git rev-parse --verify --quiet "origin/$2" || echo "$2")")';

export type UpInput = {
	repo: string;
	label: string;
	branch?: string;
	base?: string;
	memory?: string;
	cpus?: string;
	model?: string;
	root: string;
};
type Workspace = { workspace_id: string; label: string };
type Tab = { tab_id: string; label: string };
type Pane = { pane_id: string; tab_id: string; agent?: string | null };
type Created = {
	result: {
		workspace?: { workspace_id: string };
		root_pane: { pane_id: string };
	};
};

const DETECT_TIMEOUT_MS = 90_000;
const DEFAULT_CPUS = "4";
const KNOWN_STATUS = new Set(["idle", "done", "working", "blocked"]);

function parseSandboxList(text: string): { sandboxes?: Sandbox[] } {
	try {
		return JSON.parse(text) as { sandboxes?: Sandbox[] };
	} catch (error) {
		throw new Error("sbx ls returned invalid JSON", { cause: error });
	}
}

export async function up(
	input: UpInput,
	io: Io,
): Promise<{ sandbox: string; agent: string; pane: string }> {
	const memory = input.memory ?? "8g";
	const cpus = input.cpus ?? DEFAULT_CPUS;
	input = {
		...input,
		repo: io.git(["rev-parse", "--show-toplevel"], input.repo) || input.repo,
	};
	const sandbox = sandboxName(input.repo, input.label);
	const agent = agentName(sandbox);
	const origin = io.git(["remote", "get-url", "origin"], input.repo);
	const existing = fleetSandboxes(
		parseSandboxList(io.sbx(["ls", "--json"], { quiet: true })),
	).find((s: Sandbox) => s.name === sandbox);
	const task = taskDir(input.repo, sandbox, io);
	layoutTask(task, io);
	if (!existing) {
		create(input, sandbox, origin, memory, cpus, io);
		try {
			seedSubmodules(io, input.repo, sandbox);
			seedEnv(io, input.repo, sandbox);
			seedCache(io, input.repo, sandbox);
			if (input.branch)
				io.sbx(
					[
						"exec",
						sandbox,
						"sh",
						"-c",
						BRANCH_FROM_BASE,
						"--",
						input.branch,
						input.base ?? baseBranch(input.repo, io).replace(/^origin\//, ""),
					],
					{ quiet: true },
				);
		} catch (error) {
			io.sbx(["rm", "-f", sandbox], { quiet: true });
			throw new Error(
				`${sandbox}: setup failed and the container was removed\n${(error as Error).message}`,
			);
		}
		const locks = lockfiles(
			io.git(
				[
					"ls-files",
					"--",
					":(glob)**/yarn.lock",
					":(glob)**/pnpm-lock.yaml",
					":(glob)**/package-lock.json",
				],
				input.repo,
			),
		);
		if (locks) {
			io.sbx(
				[
					"exec",
					sandbox,
					"sh",
					"-c",
					`setsid nohup bash -c "$1" >${INSTALL_LOG} 2>&1 </dev/null &`,
					"--",
					installScript,
				],
				{ quiet: true },
			);
			io.log(
				`${sandbox}: created; ${locks} lockfile(s) install in the background, log ${INSTALL_LOG} in the container`,
			);
		} else {
			io.log(
				`${sandbox}: created; no lockfile in the repository, so nothing installs`,
			);
		}
	}

	const { pane, running } = openPane(io, basename(input.repo), agent);
	if (!running)
		io.herdr([
			"pane",
			"run",
			pane,
			`HERDR_AGENT=pi sbx run --name ${sandbox} -- --approve${piArgs(input.model, io.list(`${task}/logs/sessions`).length > 0)}`,
		]);
	await waitForAgent(io, pane);
	logEvent(io, "up", agent);
	io.herdr(["agent", "rename", pane, agent]);
	io.log(
		`${sandbox}: pi waiting in tab ${agent} (pane ${pane}); no prompt sent`,
	);
	return { sandbox, agent, pane };
}

function create(
	input: UpInput,
	sandbox: string,
	origin: string,
	memory: string,
	cpus: string,
	io: Io,
): void {
	const codex = codexArgs(io.read(`${io.home}/.pi/agent/auth.json`));
	const artifacts = artifactsDir(input.repo, io);
	const cache = `${io.home}/.pi/cache/${basename(input.repo)}`;
	const knowledgeBase = `${io.home}/my-knowledge-base`;
	io.mkdir(artifacts);
	io.mkdir(cache);
	try {
		io.sbx(
			[
				"secret",
				"set",
				"github",
				"--sandbox",
				sandbox,
				"--ref",
				githubRef(origin),
			],
			{ quiet: true },
		);
	} catch (error) {
		io.log(
			`${sandbox}: no GitHub token bound (${(error as Error).message.split("\n")[0]}); git fetch inside will fail until \`sbx secret set github --sandbox ${sandbox} --ref '${githubRef(origin)}'\``,
		);
	}
	const linear = linearServer(origin);
	io.sbx([
		"run",
		"-d",
		"--skills=off",
		"--name",
		sandbox,
		"--clone",
		"--memory",
		memory,
		"--cpus",
		cpus,
		"-e",
		"SSH_AUTH_SOCK_GATEWAY=",
		"-e",
		"CI=true",
		"-e",
		`FLEET_ARTIFACTS=${artifacts}`,
		"-e",
		`FLEET_CACHE=${cache}`,
		"-e",
		`PI_CODING_AGENT_SESSION_DIR=${taskDir(input.repo, sandbox, io)}/logs/sessions`,
		"--kit",
		`${input.root}/host/kits/no-ssh-agent`,
		"--kit-arg",
		`pi.codex_account=${codex.account}`,
		"--kit-arg",
		`pi.codex_sentinel=${codex.sentinel}`,
		...(linear ? ["--static-mcp", linear] : []),
		`${input.root}/host/kits/pi`,
		input.repo,
		artifacts,
		cache,
		`${knowledgeBase}:ro`,
		"--",
		"--approve",
	]);
}

function lockfiles(listing: string): number {
	return listing.split("\n").filter((line) => line.trim()).length;
}

export function envFiles(listing: string): string[] {
	return listing
		.split("\n")
		.map((line) => line.trim())
		.filter(
			(line) => line && !line.endsWith("/") && basename(line).startsWith(".env"),
		);
}

function seedEnv(io: Io, repo: string, sandbox: string): void {
	const files = envFiles(
		io.git(
			[
				"ls-files",
				"--others",
				"--ignored",
				"--exclude-standard",
				"--",
				":(glob)**/.env*",
				":(exclude,glob)**/node_modules/**",
			],
			repo,
		),
	);
	if (!files.length) return;

	const workspace = io.sbx(
		["exec", sandbox, "sh", "-c", 'printf %s "$WORKSPACE_DIR"'],
		{ quiet: true },
	);
	for (const file of files) {
		io.sbx(
			[
				"exec",
				sandbox,
				"sh",
				"-c",
				'mkdir -p "$(dirname "$1")"',
				"--",
				`${workspace}/${file}`,
			],
			{ quiet: true },
		);
		io.sbx(["cp", `${repo}/${file}`, `${sandbox}:${workspace}/${file}`], {
			quiet: true,
		});
	}

	io.log(
		`${sandbox}: copied ${files.length} ignored env file(s) from the host checkout`,
	);
}

export function cacheStore(path: string): string {
	return path.replace(/^\.\//, "").replace(/\//g, "-");
}

function cachePaths(repo: string, io: Io): string[] {
	const declared = [
		[`${repo}/turbo.json`, ".turbo/cache"],
		[`${repo}/nx.json`, ".nx/cache"],
	];

	return declared
		.filter(([config]) => io.read(config) !== undefined)
		.map(([, path]) => path);
}

function seedCache(io: Io, repo: string, sandbox: string): void {
	const cache = `${io.home}/.pi/cache/${basename(repo)}`;
	const listed = io.read(`${cache}/paths`);
	const paths = listed
		? listed
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
		: cachePaths(repo, io);
	if (!paths.length) return;
	if (!listed) io.write(`${cache}/paths`, `${paths.join("\n")}\n`);

	const workspace = io.sbx(
		["exec", sandbox, "sh", "-c", 'printf %s "$WORKSPACE_DIR"'],
		{ quiet: true },
	);
	for (const path of paths) {
		const store = `${cache}/${cacheStore(path)}`;
		io.mkdir(store);
		io.sbx(
			[
				"exec",
				sandbox,
				"sh",
				"-c",
				'mkdir -p "$(dirname "$2")" && rm -rf "$2" && ln -sfn "$1" "$2"',
				"--",
				store,
				`${workspace}/${path}`,
			],
			{ quiet: true },
		);
	}

	io.log(`${sandbox}: ${paths.join(", ")} now live in ${cache}`);
}

function seedSubmodules(io: Io, repo: string, sandbox: string): void {
	const modules = submodulePaths(io.git(["submodule", "status"], repo));
	if (!modules.length) return;
	const workspace = io.sbx(
		["exec", sandbox, "sh", "-c", 'printf %s "$WORKSPACE_DIR"'],
		{ quiet: true },
	);
	for (const module of modules) {
		io.log(`${sandbox}: copying submodule ${module}`);
		io.sbx(
			[
				"exec",
				sandbox,
				"sh",
				"-c",
				'mkdir -p "$1" "$2"',
				"--",
				`${workspace}/${parentDir(module)}`,
				`${workspace}/.git/modules/${parentDir(module)}`,
			],
			{ quiet: true },
		);
		io.sbx(
			["cp", `${repo}/${module}`, `${sandbox}:${workspace}/${parentDir(module)}/`],
			{ quiet: true },
		);
		io.sbx(
			[
				"cp",
				`${repo}/.git/modules/${module}`,
				`${sandbox}:${workspace}/.git/modules/${parentDir(module)}/`,
			],
			{ quiet: true },
		);
		io.sbx(
			[
				"exec",
				sandbox,
				"sh",
				"-c",
				'sudo chown -R agent:agent "$1" "$2" && rm -rf "$1/node_modules"',
				"--",
				`${workspace}/${module}`,
				`${workspace}/.git/modules/${module}`,
			],
			{ quiet: true },
		);
		io.sbx(
			[
				"exec",
				sandbox,
				"sh",
				"-c",
				'printf "gitdir: %s\\n" "$1" > "$2"',
				"--",
				gitdirOf(module),
				`${workspace}/${module}/.git`,
			],
			{ quiet: true },
		);
		io.sbx(
			[
				"exec",
				sandbox,
				"sh",
				"-c",
				'cd "$1" && git submodule init "$2"',
				"--",
				workspace,
				module,
			],
			{ quiet: true },
		);
	}
}

function openPane(
	io: Io,
	label: string,
	tab: string,
): { pane: string; running: boolean } {
	const named = agentFor(
		io.herdr<{ result: { agents: Agent[] } }>(["agent", "list"]).result.agents,
		tab,
	);
	if (named?.pane_id) {
		if (named.agent !== "pi")
			throw new Error(
				`agent ${tab} is ${named.agent ?? "unknown"} in pane ${named.pane_id}, not pi; rename it or pick another label`,
			);
		io.log(`${tab}: adopting the pi already running in pane ${named.pane_id}`);
		return { pane: named.pane_id, running: true };
	}
	const list = io.herdr<{ result: { workspaces: Workspace[] } }>([
		"workspace",
		"list",
	]);
	const workspace = list.result.workspaces.find(
		(w) => w.label.toLowerCase() === label.toLowerCase(),
	)?.workspace_id;
	if (!workspace) {
		const created = io.herdr<Created>([
			"workspace",
			"create",
			"--label",
			label,
			"--no-focus",
		]);
		if (created.result.workspace)
			io.herdr([
				"tab",
				"rename",
				created.result.root_pane.pane_id.replace(/:p/, ":t"),
				tab,
			]);
		return { pane: created.result.root_pane.pane_id, running: false };
	}
	const existing = io
		.herdr<{ result: { tabs: Tab[] } }>(["tab", "list", "--workspace", workspace])
		.result.tabs.find((t) => t.label === tab);
	if (existing) {
		const pane = io
			.herdr<{ result: { panes: Pane[] } }>([
				"pane",
				"list",
				"--workspace",
				workspace,
			])
			.result.panes.find((p) => p.tab_id === existing.tab_id);
		if (!pane) throw new Error(`tab ${tab} exists without a pane; close it`);
		if (pane.agent && pane.agent !== "pi")
			throw new Error(
				`tab ${tab} already runs ${pane.agent} in pane ${pane.pane_id}`,
			);
		if (pane.agent)
			io.log(`${tab}: adopting the pi already running in pane ${pane.pane_id}`);
		return { pane: pane.pane_id, running: Boolean(pane.agent) };
	}
	return {
		pane: io.herdr<Created>([
			"tab",
			"create",
			"--workspace",
			workspace,
			"--label",
			tab,
			"--no-focus",
		]).result.root_pane.pane_id,
		running: false,
	};
}

async function waitForAgent(io: Io, pane: string): Promise<void> {
	const started = io.now().getTime();
	while (io.now().getTime() - started < DETECT_TIMEOUT_MS) {
		try {
			const status =
				io.herdr<{ result: { agent: Agent } }>(["agent", "get", pane]).result.agent
					.agent_status ?? "";
			if (KNOWN_STATUS.has(status)) return;
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes("agent_not_found"))
				throw error;
		}
		await io.sleep(2000);
	}
	throw new Error(
		`pi did not come up in pane ${pane} within ${DETECT_TIMEOUT_MS / 1000}s; read the pane`,
	);
}
