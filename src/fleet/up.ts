import { basename, dirname } from "node:path";
import { codexArgs } from "./codex.ts";
import { INSTALL_LOG, installScript, setupCommand } from "./deps.ts";
import { logEvent } from "./events.ts";
import { describe, repoName, type Profile } from "../profile/profile.ts";
import { type AgentName, CLI, type Kind, KINDS } from "../harness.ts";
import { type Io, seatOf } from "./io.ts";
import { baseBranch, isBase } from "./land.ts";
import { agentName, sandboxName, slug } from "./name.ts";
import { projectOverlay, repoProfile } from "./permissions.ts";
import {
	taskDir,
	repositoryCheckout,
	repositoryManifest,
	saveRepositories,
} from "./repositories.ts";
import { agentFor, sandboxes, type Agent } from "./status.ts";
import { gitdirOf, parentDir, submodulePaths } from "./submodules.ts";

const IMAGE_SOURCES = [
	"rules",
	"skills",
	"agents",
	"fragments",
	"extensions",
	"sbx",
	"src",
];

export function imageStampPath(kind: Kind, io: Io): string {
	return `${io.home}/${kind.home}/${kind.cache}/image-stamp`;
}

export function harnessStamp(root: string, kind: Kind, io: Io): string {
	const paths = [...IMAGE_SOURCES, kind.name];
	const commit = io.git(["log", "-1", "--format=%h", "--", ...paths], root);
	return io.git(["status", "--porcelain", "--", ...paths], root)
		? `${commit} with uncommitted changes`
		: commit;
}

export function staleImage(
	root: string,
	kind: Kind,
	io: Io,
): string | undefined {
	const built = io.read(imageStampPath(kind, io))?.trim();
	const current = harnessStamp(root, kind, io);
	if (built === current) return undefined;
	return `${kind.image} was built from ${built ?? "a harness this command never stamped"}, and the harness is now ${current}: run ${CLI} build --${kind.name} so the container carries today's rules, skills and extensions`;
}

const TASK_STATUS = "status: new\nattention: none\n\n## Log\n";

function layoutTask(dir: string, io: Io): void {
	io.mkdir(`${dir}/logs/sessions`);
	if (io.read(`${dir}/status.md`) === undefined)
		io.write(`${dir}/status.md`, TASK_STATUS);
}

export function agentArgs(
	h: Kind,
	model: string | undefined,
	resume: boolean,
): string {
	return `${[...h.agentArgs, ...(model ? ["--model", model] : []), ...(resume ? [h.resume] : [])].join(" ")}`;
}

export const SWITCH_TO_BRANCH = `cd "$WORKSPACE_DIR" || exit 1
git fetch --quiet origin "$2" || { echo "cannot refresh origin/$2; refusing stale base" >&2; exit 1; }
base_sha="$(git rev-parse 'FETCH_HEAD^{commit}')" || exit 1
git update-ref refs/fleet/base "$base_sha" || exit 1
if git fetch --quiet origin "$1" 2>/dev/null; then remote_branch="$(git rev-parse 'FETCH_HEAD^{commit}')" || exit 1
else git ls-remote --exit-code --heads origin "$1" >/dev/null 2>&1; status=$?; [ "$status" -eq 2 ] || { echo "cannot check origin/$1; refusing stale branch" >&2; exit 1; }; remote_branch=""; fi
if [ -n "$remote_branch" ]; then git switch --quiet -C "$1" "$remote_branch" && echo "$1 continues the existing branch origin/$1"
elif git switch --quiet "$1" 2>/dev/null; then echo "$1 continues the local branch $1"
else git switch --quiet --no-track -c "$1" "$base_sha" && echo "$1 is new from origin/$2"; fi`;

export type UpInput = {
	repo: string;
	repos?: string[];
	label: string;
	branch?: string;
	base?: string;
	bases?: string[];
	memory?: string;
	cpus?: string;
	model?: string;
	kind?: AgentName;
	root: string;
};
type RepoPlan = {
	repo: string;
	name: string;
	base: string;
	baseSha: string;
	branch: string;
	workspace: string;
	served: string;
	profile: Profile;
};

function planRepositories(input: UpInput, branch: string, io: Io): RepoPlan[] {
	const repos = [input.repo, ...(input.repos ?? [])];
	if (new Set(repos).size !== repos.length)
		throw new Error("fleet up needs distinct repository paths");
	const workspaceNames = repos.map((repo) => slug(basename(repo)).slice(0, 100));
	const allocated = new Set([workspaceNames[0]]);
	return repos.map((repo, index) => {
		const name = repoName(io.git(["remote", "get-url", "origin"], repo));
		const base =
			input.bases?.[index] ??
			input.base ??
			baseBranch(repo, io).replace(/^origin\//, "");
		if (isBase(base, branch))
			throw new Error(`${branch} is the base branch of ${repo}`);
		let workspace = repo;
		let served = "";
		if (index > 0) {
			const name = workspaceNames[index];
			let checkout =
				workspaceNames.filter((entry) => entry === name).length > 1
					? `${index + 1}-${name}`
					: name;
			while (
				allocated.has(checkout) ||
				(checkout !== name && workspaceNames.includes(checkout))
			)
				checkout = `${index + 1}-${checkout}`;
			allocated.add(checkout);
			workspace = `/tmp/fleet-repos/${checkout}`;
			served = `/.git/fleet-repos/${checkout}.git`;
		}
		return {
			repo,
			name,
			base,
			branch,
			baseSha: "",
			workspace,
			served,
			profile: repoProfile(input.root, name, io),
		};
	});
}

function cloneSecondary(
	plan: RepoPlan,
	sandbox: string,
	task: string,
	io: Io,
): void {
	const bundle = `${task}/${basename(plan.workspace)}.bundle`;
	const guestBundle = `/tmp/${basename(plan.workspace)}.bundle`;
	const refs = [`origin/${plan.base}`];
	for (const ref of [
		`refs/remotes/origin/${plan.branch}`,
		`refs/heads/${plan.branch}`,
	]) {
		if (io.git(["for-each-ref", "--format=%(refname)", ref], plan.repo))
			refs.push(ref);
	}
	io.git(["bundle", "create", bundle, ...refs], plan.repo);
	io.sbx(["cp", bundle, `${sandbox}:${guestBundle}`], { quiet: true });
	io.sbx(
		[
			"exec",
			sandbox,
			"sh",
			"-c",
			'mkdir -p "$(dirname "$2")" "$WORKSPACE_DIR/.git/fleet-repos" && git init --quiet --separate-git-dir="$WORKSPACE_DIR/.git/fleet-repos/$4.git" "$2" && git -C "$2" fetch --quiet "$1" "refs/remotes/origin/*:refs/remotes/origin/*" "refs/heads/*:refs/heads/*" && git -C "$2" remote add origin "$3"',
			"--",
			guestBundle,
			plan.workspace,
			`https://github.com/${plan.name}.git`,
			basename(plan.workspace),
		],
		{ quiet: true },
	);
	io.sbx(
		[
			"exec",
			sandbox,
			"sh",
			"-c",
			`export WORKSPACE_DIR="$1"; shift\n${SWITCH_TO_BRANCH}`,
			"--",
			plan.workspace,
			plan.branch,
			plan.base,
		],
		{ quiet: true },
	);
}

function fetchedBase(plan: RepoPlan, sandbox: string, io: Io): string {
	const sha = io.sbx(
		[
			"exec",
			sandbox,
			"git",
			"-C",
			plan.workspace,
			"rev-parse",
			"refs/fleet/base",
		],
		{ quiet: true },
	);
	if (!/^[0-9a-f]{40,64}$/.test(sha))
		throw new Error(
			`${plan.name}: no verified origin/${plan.base} SHA from the sandbox`,
		);
	return sha;
}

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
	const seat = seatOf(io);
	const kind = KINDS[input.kind ?? seat.name];
	const stale = staleImage(input.root, kind, io);
	if (stale) io.log(stale);
	input = {
		...input,
		repo: io.git(["rev-parse", "--show-toplevel"], input.repo) || input.repo,
		repos: input.repos?.map(
			(repo) => io.git(["rev-parse", "--show-toplevel"], repo) || repo,
		),
	};
	const sandbox = sandboxName(input.repo, input.label, kind.prefix);
	const agent = agentName(sandbox);
	const name = repoName(io.git(["remote", "get-url", "origin"], input.repo));
	const profile = repoProfile(input.root, name, io);
	const existing = sandboxes(io).find((s) => s.name === sandbox);
	const found = findPane(io, basename(input.repo), agent, kind);
	const task = taskDir(input.repo, sandbox, io, input.repos ?? []);
	layoutTask(task, io);
	if (existing && input.repos?.length && !repositoryManifest(sandbox, io))
		throw new Error(`${sandbox} already exists with different repositories`);
	if (!existing) {
		const variable = sessionToken(profile);
		if (variable && !io.env(variable))
			throw new Error(
				`${name} takes its container token from ${variable}, and this session has none: start ${seat.name} with ${variable} set, as SETUP.md (5. GitHub tokens) shows`,
			);
		const openai = !input.model || input.model.startsWith("openai-codex/");
		if (
			kind.codex &&
			openai &&
			!/\bopenai:/.test(io.read(`${io.home}/.config/sbx/credentials.yaml`) ?? "")
		)
			throw new Error(
				`no sbx binding lets openai in, so every model call in ${sandbox} would be a 401: write ~/.config/sbx/credentials.yaml as SETUP.md (6. Model credentials in sandboxes) shows, then run up again`,
			);
		const branch = input.branch ?? slug(input.label);
		const base =
			input.bases?.[0] ??
			input.base ??
			baseBranch(input.repo, io).replace(/^origin\//, "");
		if (isBase(base, branch))
			throw new Error(
				`${branch} is the default branch, and a container never works on it: give the task its own label, or --branch <name>`,
			);
		const plans = planRepositories(input, branch, io);
		const group = plans.length > 1;
		for (const plan of plans) {
			if (plan.profile.container.token !== profile.container.token)
				throw new Error(
					`${plan.name}: a shared sandbox needs the same GitHub credential binding for every repository`,
				);
			if (
				plan.profile.container.linear !== profile.container.linear ||
				plan.profile.container.linearServer !== profile.container.linearServer
			)
				throw new Error(
					`${plan.name}: a shared sandbox needs the same Linear binding for every repository`,
				);
		}
		create(input, sandbox, profile, kind, io, task);
		let locks: number;
		try {
			if (!group && profile.container.push === "auto")
				refuseOtherPrivate(io, sandbox, name);
			seedSubmodules(io, input.repo, sandbox);
			seedEnv(io, input.repo, sandbox);
			seedCache(io, input.repo, sandbox, kind);
			if (kind.projectConfig)
				seedProjectConfig(io, input.repo, sandbox, kind.projectConfig);
			if (kind.sbxGuidance)
				io.sbx(
					[
						"exec",
						sandbox,
						"sh",
						"-c",
						'f="$(dirname "$WORKSPACE_DIR")/$1"; [ ! -f "$f" ] || sudo truncate -s 0 "$f"',
						"--",
						kind.sbxGuidance,
					],
					{ quiet: true },
				);
			const integration = kind.herdrIntegration;
			if (integration)
				io.sbx(
					[
						"cp",
						`${io.home}/${kind.home}/${integration}`,
						`${sandbox}:/home/agent/${kind.home}/${integration}`,
					],
					{ quiet: true },
				);
			for (const line of io
				.sbx(["exec", sandbox, "sh", "-c", SWITCH_TO_BRANCH, "--", branch, base], {
					quiet: true,
				})
				.split("\n")
				.filter(Boolean))
				io.log(`${sandbox}: ${line}`);
			plans[0].baseSha = fetchedBase(plans[0], sandbox, io);
			for (const plan of plans.slice(1)) {
				cloneSecondary(plan, sandbox, task, io);
				plan.baseSha = fetchedBase(plan, sandbox, io);
				seedSubmodules(io, plan.repo, sandbox, plan.workspace);
				seedEnv(io, plan.repo, sandbox, plan.workspace);
				if (kind.projectConfig)
					seedProjectConfig(
						io,
						plan.repo,
						sandbox,
						kind.projectConfig,
						plan.workspace,
					);
			}
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
		if (group) {
			const runbook = `${dirname(task)}/runbook`;
			io.mkdir(runbook);
			if (io.read(`${runbook}/README.md`) === undefined)
				io.write(
					`${runbook}/README.md`,
					`# Repository group\n\n${plans
						.map((plan) => `- ${plan.name}`)
						.sort()
						.join(
							"\n",
						)}\n\nRecord verified test startup commands in run.md and run.sh here. Each task's repositories.json supplies its checkout paths, branches and base SHAs.\n`,
				);
		}
		const resources = {
			memory: input.memory ?? profile.resources.memory,
			cpus: input.cpus ?? profile.resources.cpus,
		};
		const allowed = group
			? plans
					.map((plan) =>
						describe(plan.name, {
							...plan.profile,
							container: { ...plan.profile.container, push: "none" },
							resources,
						}),
					)
					.join("\n\n")
			: describe(name, { ...profile, resources });
		io.write(`${task}/permissions.md`, allowed);
		io.log(allowed);
		const overlay = projectOverlay(name, io);
		if (overlay === undefined) io.remove(`${task}/project.md`);
		else io.write(`${task}/project.md`, overlay);
		const setup = setupCommand(overlay);
		if (locks || setup) {
			io.sbx(
				[
					"exec",
					sandbox,
					"sh",
					"-c",
					`setsid nohup bash -c "$1" >${INSTALL_LOG} 2>&1 </dev/null &`,
					"--",
					installScript(setup),
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
		const repositories = plans.map(
			({ repo, name, base, baseSha, branch, workspace, served }) => ({
				repo,
				name,
				base,
				baseSha,
				branch,
				workspace,
				served,
			}),
		);
		saveRepositories(sandbox, task, { version: 1, task, repositories }, io);
		if (group) {
			const status = io.read(`${task}/status.md`) ?? TASK_STATUS;
			if (!status.includes("## Repositories")) {
				const snapshots = plans
					.map((plan) => {
						const current = repositoryCheckout(io, sandbox, plan.workspace);
						return `- ${plan.name}: ${current.branch} dirty ${current.dirty} ${current.head} (base origin/${plan.base} ${plan.baseSha})`;
					})
					.join("\n");
				io.write(
					`${task}/status.md`,
					status.replace("## Log", `## Repositories\n${snapshots}\n\n## Log`),
				);
			}
			for (const plan of plans.slice(1)) {
				const otherOverlay = projectOverlay(plan.name, io);
				if (otherOverlay !== undefined) {
					io.mkdir(`${task}/projects`);
					io.write(`${task}/projects/${basename(plan.workspace)}.md`, otherOverlay);
				}
				const otherSetup = setupCommand(otherOverlay);
				const otherLocks = lockfiles(
					io.sbx(
						[
							"exec",
							sandbox,
							"sh",
							"-c",
							'cd "$1" && shift && git ls-files -- "$@"',
							"--",
							plan.workspace,
							":(glob)**/yarn.lock",
							":(glob)**/pnpm-lock.yaml",
							":(glob)**/package-lock.json",
						],
						{ quiet: true },
					),
				);
				if (otherLocks || otherSetup) {
					const log = `${INSTALL_LOG.slice(0, -4)}-${basename(plan.workspace)}.log`;
					io.sbx(
						[
							"exec",
							sandbox,
							"sh",
							"-c",
							`export WORKSPACE_DIR="$1"; shift; setsid nohup bash -c "$1" >${log} 2>&1 </dev/null &`,
							"--",
							plan.workspace,
							installScript(otherSetup),
						],
						{ quiet: true },
					);
					io.log(
						`${sandbox}: ${plan.name} installs ${otherLocks} lockfile(s) in the background, log ${log}`,
					);
				}
			}
		}
	}

	const { pane, running } = openPane(io, basename(input.repo), agent, found);
	if (!running) {
		const args = agentArgs(
			kind,
			input.model,
			io.list(`${task}/logs/sessions`).length > 0 ||
				(Boolean(existing) && Boolean(kind.containerSessions)),
		);
		const start = kind.herdrIntegration
			? `${input.root}/bin/${CLI} relay ${sandbox} ${task}`
			: `sbx run --name ${sandbox}`;
		io.herdr([
			"pane",
			"run",
			pane,
			`HERDR_AGENT=${kind.name} ${start}${args ? ` -- ${args}` : ""}`,
		]);
	}
	await waitForAgent(io, pane, sandbox, kind);
	logEvent(io, "up", agent);
	io.herdr(["agent", "rename", pane, agent]);
	io.log(
		`${sandbox}: the container's agent waiting in tab ${agent} (pane ${pane}); no prompt sent`,
	);
	return { sandbox, agent, pane };
}

function sessionToken(profile: Profile): string | undefined {
	return profile.container.token.startsWith("env:")
		? profile.container.token.slice("env:".length)
		: undefined;
}

function refuseOtherPrivate(io: Io, sandbox: string, name: string): void {
	const seen = io
		.sbx(
			[
				"exec",
				sandbox,
				"gh",
				"api",
				"/user/repos",
				"--paginate",
				"--jq",
				".[] | select(.private) | .full_name",
			],
			{ quiet: true },
		)
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (seen.every((repo) => repo.toLowerCase() === name.toLowerCase())) return;
	throw new Error(
		`container.push is auto, so the token may see no private repository other than ${name || "this one"}; it sees ${seen.join(", ")}. Scope the token to ${name || "this repository"} alone, or lower container.push in the profile`,
	);
}

function create(
	input: UpInput,
	sandbox: string,
	profile: Profile,
	h: Kind,
	io: Io,
	task: string,
): void {
	const artifacts = dirname(task);
	const cache = cacheDir(input.repo, h, io);
	io.mkdir(artifacts);
	io.mkdir(cache);
	const variable = sessionToken(profile);
	try {
		if (variable)
			io.sbx(["secret", "set", "github", "--sandbox", sandbox], {
				quiet: true,
				input: io.env(variable),
			});
		else
			io.sbx(
				[
					"secret",
					"set",
					"github",
					"--sandbox",
					sandbox,
					"--ref",
					profile.container.token,
				],
				{ quiet: true },
			);
	} catch (error) {
		io.log(
			`${sandbox}: no GitHub token bound (${(error as Error).message.split("\n")[0]}); git fetch inside will fail until \`${variable ? `printenv ${variable} | sbx secret set github --sandbox ${sandbox}` : `sbx secret set github --sandbox ${sandbox} --ref '${profile.container.token}'`}\``,
		);
	}
	const linear =
		profile.container.linear === "none"
			? undefined
			: profile.container.linearServer;
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
		...(input.repos?.length
			? ["-e", `FLEET_REPOSITORIES=${input.repos.length + 1}`]
			: []),
		"-e",
		`FLEET_ARTIFACTS=${artifacts}`,
		"-e",
		`FLEET_CACHE=${cache}`,
		"-e",
		`npm_config_cache=${cache}/npm`,
		...h.env.flatMap((entry) => ["-e", entry]),

		...(h.sessionEnv ? ["-e", `${h.sessionEnv}=${task}/logs/sessions`] : []),
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
		...(h.agentArgs.length ? ["--", ...h.agentArgs] : []),
	]);
}

export function cacheDir(repo: string, kind: Kind, io: Io): string {
	return `${io.home}/${kind.home}/${kind.cache}/${basename(repo)}`;
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

function seedEnv(
	io: Io,
	repo: string,
	sandbox: string,
	guestWorkspace?: string,
): void {
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

	const workspace =
		guestWorkspace ??
		io.sbx(["exec", sandbox, "sh", "-c", 'printf %s "$WORKSPACE_DIR"'], {
			quiet: true,
		});
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
		[
			"exec",
			sandbox,
			"sh",
			"-c",
			'cd "$1" && shift && sudo chown "$(id -u):$(id -g)" -- "$@"',
			"--",
			workspace,
			...files,
		],
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
	guestWorkspace?: string,
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
	const workspace =
		guestWorkspace ??
		io.sbx(["exec", sandbox, "sh", "-c", 'printf %s "$WORKSPACE_DIR"'], {
			quiet: true,
		});
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

function seedCache(io: Io, repo: string, sandbox: string, kind: Kind): void {
	const cache = cacheDir(repo, kind, io);
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

function seedSubmodules(
	io: Io,
	repo: string,
	sandbox: string,
	guestWorkspace?: string,
): void {
	const modules = submodulePaths(io.git(["submodule", "status"], repo));
	if (!modules.length) return;
	const workspace =
		guestWorkspace ??
		io.sbx(["exec", sandbox, "sh", "-c", 'printf %s "$WORKSPACE_DIR"'], {
			quiet: true,
		});
	const gitDir = io.sbx(
		["exec", sandbox, "git", "-C", workspace, "rev-parse", "--absolute-git-dir"],
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
				`${gitDir}/modules/${parentDir(module)}`,
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
				`${sandbox}:${gitDir}/modules/${parentDir(module)}/`,
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
				gitdirOf(gitDir, module),
			],
			{ quiet: true },
		);
		io.sbx(
			[
				"exec",
				sandbox,
				"sh",
				"-c",
				'printf "gitdir: %s\\n" "$1" > "$2/.git" && git config --file "$1/config" core.worktree "$2"',
				"--",
				gitdirOf(gitDir, module),
				`${workspace}/${module}`,
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

function findPane(io: Io, label: string, tab: string, kind: Kind): Found {
	const named = agentFor(
		io.herdr<{ result: { agents: Agent[] } }>(["agent", "list"]).result.agents,
		tab,
	);
	if (named?.pane_id) {
		if (named.agent !== kind.name)
			throw new Error(
				`agent ${tab} is ${named.agent ?? "unknown"} in pane ${named.pane_id}, not ${kind.name}; rename it or pick another label`,
			);
		io.log(
			`${tab}: adopting the container's agent already running in pane ${named.pane_id}`,
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
	if (pane.agent && pane.agent !== kind.name)
		throw new Error(
			`tab ${tab} already runs ${pane.agent} in pane ${pane.pane_id}`,
		);
	if (pane.agent)
		io.log(
			`${tab}: adopting the container's agent already running in pane ${pane.pane_id}`,
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
	kind: Kind,
): Promise<void> {
	const started = io.now().getTime();
	let probeError: unknown;
	while (io.now().getTime() - started < DETECT_TIMEOUT_MS) {
		try {
			const status =
				io.herdr<{ result: { agent: Agent } }>(["agent", "get", pane]).result.agent
					.agent_status ?? "";
			if (KNOWN_STATUS.has(status)) {
				let runs = false;
				try {
					runs = agentRuns(io, sandbox, kind);
				} catch (error) {
					probeError = error;
				}
				if (runs) {
					if (
						kind.name !== "pi" &&
						io
							.herdrText(["agent", "read", pane, "--source", "visible"])
							.includes("Not logged in")
					)
						throw new Error(
							`${sandbox}: the container's agent is not logged in, so it cannot take a prompt; run /login in tab ${agentName(sandbox)}, then steer`,
						);
					return;
				}
			}
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes("agent_not_found"))
				throw error;
		}
		await io.sleep(2000);
	}
	throw new Error(
		`the container's agent did not become ready in pane ${pane} within ${DETECT_TIMEOUT_MS / 1000}s; read the pane${probeError ? `; process probe: ${String(probeError)}` : ""}`,
	);
}

function agentRuns(io: Io, sandbox: string, kind: Kind): boolean {
	if (kind.name !== "pi") {
		io.sbx(["exec", sandbox, "pgrep", "-x", kind.name], { quiet: true });
		return true;
	}
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
	return tty.includes("-icanon") && tty.includes("-icrnl");
}
