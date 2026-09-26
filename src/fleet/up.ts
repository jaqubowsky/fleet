import { basename } from "node:path";
import { codexArgs } from "./codex.ts";
import { INSTALL_LOG, installScript } from "./deps.ts";
import { logEvent } from "./events.ts";
import { describe, repoName, type Profile } from "../profile/profile.ts";
import type { Harness } from "../harness.ts";
import type { Io } from "./io.ts";
import { baseBranch } from "./land.ts";
import { agentName, sandboxName } from "./name.ts";
import { repoProfile } from "./permissions.ts";
import { agentFor, sandboxes, type Agent } from "./status.ts";
import { gitdirOf, parentDir, submodulePaths } from "./submodules.ts";

export function artifactsDir(repo: string, io: Io): string {
	return `${io.home}/.sandboxes/${basename(repo)}`;
}

export function taskDir(repo: string, sandbox: string, io: Io): string {
	return `${artifactsDir(repo, io)}/${sandbox}`;
}

const IMAGE_SOURCES = [
	"rules",
	"skills",
	"agents",
	"fragments",
	"extensions",
	"sbx",
	"src",
];

export function imageStampPath(io: Io): string {
	return `${io.home}/${io.harness.home}/${io.harness.cache}/image-stamp`;
}

export function harnessStamp(root: string, io: Io): string {
	const paths = [...IMAGE_SOURCES, io.harness.name];
	const commit = io.git(["log", "-1", "--format=%h", "--", ...paths], root);
	return io.git(["status", "--porcelain", "--", ...paths], root)
		? `${commit} with uncommitted changes`
		: commit;
}

export function staleImage(root: string, io: Io): string | undefined {
	const built = io.read(imageStampPath(io))?.trim();
	const current = harnessStamp(root, io);
	if (built === current) return undefined;
	return `${io.harness.image} was built from ${built ?? "a harness this command never stamped"}, and the harness is now ${current}: run ${io.harness.cli} build so the container carries today's rules, skills and extensions`;
}

const TASK_STATUS =
	"status: new\nattention: none\n\n## Summary\nNo progress or verification has been recorded yet.\n\n## Next step\nFollow the assigned task and record the first progress update.\n\n## Log\n";

function layoutTask(dir: string, io: Io): void {
	io.mkdir(`${dir}/logs/sessions`);
	if (io.read(`${dir}/status.md`) === undefined)
		io.write(`${dir}/status.md`, TASK_STATUS);
}

export function agentArgs(
	h: Harness,
	model: string | undefined,
	resume: boolean,
): string {
	return `${[...h.agentArgs, ...(model ? ["--model", model] : []), ...(resume ? [h.resume] : [])].join(" ")}`;
}

export const SWITCH_TO_BRANCH = `cd "$WORKSPACE_DIR" || exit 1
git fetch --quiet origin "$2" || echo "fetch of $2 failed, branching from the local base"
git fetch --quiet origin "$1" 2>/dev/null || { git ls-remote --exit-code --heads origin "$1" >/dev/null 2>&1; [ $? -eq 2 ] || echo "fetch of $1 failed, so a branch origin holds starts from the base"; }
if git rev-parse --verify --quiet "origin/$1" >/dev/null; then git switch --quiet -C "$1" "origin/$1" && echo "$1 continues the existing branch origin/$1"
elif git switch --quiet "$1" 2>/dev/null; then echo "$1 continues the local branch $1"
else start="origin/$2"; git rev-parse --verify --quiet "$start" >/dev/null || start="$2"; git switch --quiet -c "$1" "$start" && echo "$1 is new from $start"; fi`;

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
const KNOWN_STATUS = new Set(["idle", "done", "working", "blocked"]);

export async function up(
	input: UpInput,
	io: Io,
): Promise<{ sandbox: string; agent: string; pane: string }> {
	const stale = staleImage(input.root, io);
	if (stale) io.log(stale);
	input = {
		...input,
		repo: io.git(["rev-parse", "--show-toplevel"], input.repo) || input.repo,
	};
	const sandbox = sandboxName(input.repo, input.label, io.harness.prefix);
	const agent = agentName(sandbox);
	const name = repoName(io.git(["remote", "get-url", "origin"], input.repo));
	const profile = repoProfile(input.root, name, io);
	const existing = sandboxes(io).find((s) => s.name === sandbox);
	const found = findPane(io, basename(input.repo), agent);
	const task = taskDir(input.repo, sandbox, io);
	layoutTask(task, io);
	if (!existing) {
		const variable = sessionToken(profile);
		if (variable && !io.env(variable))
			throw new Error(
				`${name} takes its container token from ${variable}, and this session has none: start ${io.harness.agent} with ${variable} set, as inventory.md (GitHub tokens) shows`,
			);
		const openai = !input.model || input.model.startsWith("openai-codex/");
		if (io.harness.codex && openai && !/\bopenai:/.test(io.read(`${io.home}/.config/sbx/credentials.yaml`) ?? ""))
			throw new Error(
				`no sbx binding lets openai in, so every model call in ${sandbox} would be a 401: write ~/.config/sbx/credentials.yaml as inventory.md (Model credentials) shows, then run up again`,
			);
		create(input, sandbox, profile, io);
		let locks: number;
		try {
			if (profile.container.push === "auto") refuseOtherPrivate(io, sandbox, name);
			seedSubmodules(io, input.repo, sandbox);
			seedEnv(io, input.repo, sandbox);
			seedCache(io, input.repo, sandbox);
			if (io.harness.projectConfig)
				seedProjectConfig(io, input.repo, sandbox, io.harness.projectConfig);
			if (io.harness.sbxGuidance)
				io.sbx(
					["exec", sandbox, "sh", "-c", 'f="$(dirname "$WORKSPACE_DIR")/$1"; [ ! -f "$f" ] || sudo truncate -s 0 "$f"', "--", io.harness.sbxGuidance],
					{ quiet: true },
				);
			const integration = io.harness.herdrIntegration;
			if (integration)
				io.sbx(
					[
						"cp",
						`${io.home}/${io.harness.home}/${integration}`,
						`${sandbox}:/home/agent/${io.harness.home}/${integration}`,
					],
					{ quiet: true },
				);
			if (input.branch)
				for (const line of io.sbx(
					[
						"exec",
						sandbox,
						"sh",
						"-c",
						SWITCH_TO_BRANCH,
						"--",
						input.branch,
						input.base ?? baseBranch(input.repo, io).replace(/^origin\//, ""),
					],
					{ quiet: true },
				).split("\n").filter(Boolean))
					io.log(`${sandbox}: ${line}`);
			locks = lockfiles(
				io.sbx(
					[
						"exec",
						sandbox,
						"sh",
						"-c",
						'cd "$WORKSPACE_DIR" && git ls-files -- "$@"',
						"--",
						":(glob)**/yarn.lock",
						":(glob)**/pnpm-lock.yaml",
						":(glob)**/package-lock.json",
					],
					{ quiet: true },
				),
			);
		} catch (error) {
			io.sbx(["rm", "-f", sandbox], { quiet: true });
			throw new Error(
				`${sandbox}: setup failed and the container was removed\n${(error as Error).message}`,
			);
		}
		const resources = { memory: input.memory ?? profile.resources.memory, cpus: input.cpus ?? profile.resources.cpus };
		const allowed = describe(name, { ...profile, resources }, io.harness.cli);
		io.write(`${task}/permissions.md`, allowed);
		io.log(allowed);
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

	const { pane, running } = openPane(io, basename(input.repo), agent, found);
	if (!running) {
		const args = agentArgs(
			io.harness,
			input.model,
			io.list(`${task}/logs/sessions`).length > 0 ||
				(Boolean(existing) && Boolean(io.harness.containerSessions)),
		);
		const start = io.harness.herdrIntegration
			? `${input.root}/bin/${io.harness.cli} relay ${sandbox} ${task}`
			: `sbx run --name ${sandbox}`;
		io.herdr([
			"pane",
			"run",
			pane,
			`HERDR_AGENT=${io.harness.agent} ${start}${args ? ` -- ${args}` : ""}`,
		]);
	}
	await waitForAgent(io, pane, sandbox);
	logEvent(io, "up", agent);
	io.herdr(["agent", "rename", pane, agent]);
	io.log(
		`${sandbox}: ${io.harness.agent} waiting in tab ${agent} (pane ${pane}); no prompt sent`,
	);
	return { sandbox, agent, pane };
}

function sessionToken(profile: Profile): string | undefined {
	return profile.container.token.startsWith("env:") ? profile.container.token.slice("env:".length) : undefined;
}

function refuseOtherPrivate(io: Io, sandbox: string, name: string): void {
	const seen = io
		.sbx(["exec", sandbox, "gh", "api", "/user/repos", "--paginate", "--jq", ".[] | select(.private) | .full_name"], { quiet: true })
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (seen.every((repo) => repo.toLowerCase() === name.toLowerCase())) return;
	throw new Error(
		`container.push is auto, so the token may see no private repository other than ${name || "this one"}; it sees ${seen.join(", ")}. Scope the token to ${name || "this repository"} alone, or lower container.push in the profile`,
	);
}

function create(input: UpInput, sandbox: string, profile: Profile, io: Io): void {
	const h = io.harness;
	const artifacts = artifactsDir(input.repo, io);
	const cache = cacheDir(input.repo, io);
	const knowledgeBase = `${io.home}/my-knowledge-base`;
	io.mkdir(artifacts);
	io.mkdir(cache);
	const variable = sessionToken(profile);
	try {
		if (variable) io.sbx(["secret", "set", "github", "--sandbox", sandbox], { quiet: true, input: io.env(variable) });
		else io.sbx(["secret", "set", "github", "--sandbox", sandbox, "--ref", profile.container.token], { quiet: true });
	} catch (error) {
		io.log(
			`${sandbox}: no GitHub token bound (${(error as Error).message.split("\n")[0]}); git fetch inside will fail until \`${variable ? `printenv ${variable} | sbx secret set github --sandbox ${sandbox}` : `sbx secret set github --sandbox ${sandbox} --ref '${profile.container.token}'`}\``,
		);
	}
	const linear = profile.container.linear === "none" ? undefined : profile.container.linearServer;
	const codex = h.codex
		? codexArgs(io.read(`${io.home}/${h.home}/${h.codex.auth}`))
		: undefined;
	io.sbx([
		"run",
		"-d",
		...h.sbxFlags,
		"--name",
		sandbox,
		"--clone",
		"--memory",
		input.memory ?? profile.resources.memory,
		"--cpus",
		input.cpus ?? profile.resources.cpus,
		"-e",
		"SSH_AUTH_SOCK_GATEWAY=",
		"-e",
		"CI=true",
		"-e",
		`FLEET_ARTIFACTS=${artifacts}`,
		"-e",
		`FLEET_CACHE=${cache}`,
		...h.env.flatMap((entry) => ["-e", entry]),

		...(h.sessionEnv
			? ["-e", `${h.sessionEnv}=${taskDir(input.repo, sandbox, io)}/logs/sessions`]
			: []),
		"--kit",
		`${input.root}/host/kits/no-ssh-agent`,
		...(codex && h.codex
			? [
					"--kit-arg",
					`${h.codex.kit}.codex_account=${codex.account}`,
					"--kit-arg",
					`${h.codex.kit}.codex_sentinel=${codex.sentinel}`,
				]
			: []),
		...(linear ? ["--static-mcp", linear] : []),
		h.agentSpec(input.root),
		input.repo,
		artifacts,
		cache,
		`${knowledgeBase}:ro`,
		...(h.agentArgs.length ? ["--", ...h.agentArgs] : []),
	]);
}

export function cacheDir(repo: string, io: Io): string {
	return `${io.home}/${io.harness.home}/${io.harness.cache}/${basename(repo)}`;
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
	io.sbx(
		["exec", sandbox, "sh", "-c", 'cd "$1" && shift && sudo chown "$(id -u):$(id -g)" -- "$@"', "--", workspace, ...files],
		{ quiet: true },
	);

	io.log(
		`${sandbox}: copied ${files.length} ignored env file(s) from the host checkout`,
	);
}

export function ignoredPaths(listing: string): string[] {
	return listing
		.split("\n")
		.map((line) => line.trim().replace(/\/$/, ""))
		.filter(Boolean);
}

function seedProjectConfig(
	io: Io,
	repo: string,
	sandbox: string,
	dir: string,
): void {
	const paths = ignoredPaths(
		io.git(
			[
				"ls-files",
				"--others",
				"--ignored",
				"--exclude-standard",
				"--directory",
				"--",
				dir,
			],
			repo,
		),
	);
	if (!paths.length) return;
	const workspace = io.sbx(
		["exec", sandbox, "sh", "-c", 'printf %s "$WORKSPACE_DIR"'],
		{ quiet: true },
	);
	for (const path of paths) {
		io.sbx(
			[
				"exec",
				sandbox,
				"sh",
				"-c",
				'mkdir -p "$1"',
				"--",
				`${workspace}/${parentDir(path)}`,
			],
			{ quiet: true },
		);
		io.sbx(
			["cp", `${repo}/${path}`, `${sandbox}:${workspace}/${parentDir(path)}/`],
			{ quiet: true },
		);
	}
	io.log(
		`${sandbox}: copied ${paths.length} ignored path(s) under ${dir} from the host checkout`,
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
	const cache = cacheDir(repo, io);
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

type Found = { pane: string; running: boolean } | { workspace?: string };

function findPane(io: Io, label: string, tab: string): Found {
	const named = agentFor(
		io.herdr<{ result: { agents: Agent[] } }>(["agent", "list"]).result.agents,
		tab,
	);
	if (named?.pane_id) {
		if (named.agent !== io.harness.agent)
			throw new Error(
				`agent ${tab} is ${named.agent ?? "unknown"} in pane ${named.pane_id}, not ${io.harness.agent}; rename it or pick another label`,
			);
		io.log(
			`${tab}: adopting the ${io.harness.agent} already running in pane ${named.pane_id}`,
		);
		return { pane: named.pane_id, running: true };
	}
	const list = io.herdr<{ result: { workspaces: Workspace[] } }>([
		"workspace",
		"list",
	]);
	const workspace = list.result.workspaces.find(
		(w) => w.label.toLowerCase() === label.toLowerCase(),
	)?.workspace_id;
	if (!workspace) return {};
	const existing = io
		.herdr<{ result: { tabs: Tab[] } }>(["tab", "list", "--workspace", workspace])
		.result.tabs.find((t) => t.label === tab);
	if (!existing) return { workspace };
	const pane = io
		.herdr<{ result: { panes: Pane[] } }>([
			"pane",
			"list",
			"--workspace",
			workspace,
		])
		.result.panes.find((p) => p.tab_id === existing.tab_id);
	if (!pane) throw new Error(`tab ${tab} exists without a pane; close it`);
	if (pane.agent && pane.agent !== io.harness.agent)
		throw new Error(
			`tab ${tab} already runs ${pane.agent} in pane ${pane.pane_id}`,
		);
	if (pane.agent)
		io.log(
			`${tab}: adopting the ${io.harness.agent} already running in pane ${pane.pane_id}`,
		);
	return { pane: pane.pane_id, running: Boolean(pane.agent) };
}

function openPane(
	io: Io,
	label: string,
	tab: string,
	found: Found,
): { pane: string; running: boolean } {
	if ("pane" in found) return found;
	if (!found.workspace) {
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
	return {
		pane: io.herdr<Created>([
			"tab",
			"create",
			"--workspace",
			found.workspace,
			"--label",
			tab,
			"--no-focus",
		]).result.root_pane.pane_id,
		running: false,
	};
}

async function waitForAgent(
	io: Io,
	pane: string,
	sandbox: string,
): Promise<void> {
	const started = io.now().getTime();
	let probeError: unknown;
	while (io.now().getTime() - started < DETECT_TIMEOUT_MS) {
		try {
			const status =
				io.herdr<{ result: { agent: Agent } }>(["agent", "get", pane]).result.agent
					.agent_status ?? "";
			if (KNOWN_STATUS.has(status)) {
				if (io.harness.agent !== "pi") {
					if (io.herdrText(["agent", "read", pane, "--source", "visible"]).includes("Not logged in"))
						throw new Error(
							`${sandbox}: ${io.harness.agent} is not logged in, so it cannot take a prompt; run /login in tab ${agentName(sandbox)}, then steer`,
						);
					return;
				}
				try {
					const tty = io.sbx(
						[
							"exec",
							sandbox,
							"sh",
							"-c",
							'stty -F "$(readlink /proc/$(pgrep -xo pi)/fd/0)" -a',
						],
						{ quiet: true },
					);
					if (tty.includes("-icanon") && tty.includes("-icrnl")) return;
				} catch (error) {
					probeError = error;
				}
			}
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes("agent_not_found"))
				throw error;
		}
		await io.sleep(2000);
	}
	throw new Error(
		`${io.harness.agent} did not become ready in pane ${pane} within ${DETECT_TIMEOUT_MS / 1000}s; read the pane${probeError ? `; tty probe: ${String(probeError)}` : ""}`,
	);
}
