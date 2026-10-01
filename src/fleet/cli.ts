import { homedir } from "node:os";
import { resolve } from "node:path";
import { type AgentName, CLI, SEATS } from "../harness.ts";
import { render } from "../render/render.ts";
import {
	artifacts,
	build,
	copy,
	down,
	exec,
	handoff,
	history,
	ls,
	peek,
	renderHost,
	resolveSandbox,
	steer,
} from "./commands.ts";
import { init } from "./init.ts";
import { realIo, seatOf } from "./io.ts";
import { land } from "./land.ts";
import { permissions } from "./permissions.ts";
import { repositoryManifest } from "./repositories.ts";
import { relay } from "./relay.ts";
import { loadProfiles } from "../profile/profile.ts";
import { askHidden, keychain, listTokens, setToken } from "./tokens.ts";
import { up } from "./up.ts";
import { paneScope, watch } from "./watch.ts";

const home = homedir();
const root = process.env.FLEET_ROOT ?? resolve(import.meta.dirname, "../..");
const seat = process.env.FLEET_SEAT;
const io = realIo(
	home,
	seat && Object.hasOwn(SEATS, seat) ? SEATS[seat as AgentName] : undefined,
);

const usage = `usage:
  ${CLI} up <label> [--repo <path> ...] [--pi|--claude] [--branch <name>] [--base <name> ...] [--model <model>] [--memory 8g] [--cpus 4]   clone one repo, or repeat --repo for N private repos (first primary, additional clones imported via Git bundles); each takes its own fetched origin base and branch, one --base applies to all and one --base per repo selects bases in --repo order, --branch names a branch in each, never the default; bind each profile, lay out the task directory with permissions.md and, when ~/.fleet/config/projects holds an overlay, project.md, start the container's agent in a herdr tab, the seat's own without --pi|--claude, send nothing
  ${CLI} init <repo>                                  lay the project seed out in <repo>: AGENTS.md, spec/vision.md; a file already there stays as it is
  ${CLI} profile [<repo>] [--apply [--brief]]         what ~/.fleet/config/repos.json, then host/repos.json, lets each seat do in <repo>, a checkout (default here) or owner/name, then its ~/.fleet/config/projects overlay; --apply sets the checkout's commit.gpgsign, where the host pushes on its own an HTTPS origin, and registers the host Linear server in both pi and Claude for this checkout, from a host session or plain shell; --brief prints only what --apply changed, and nothing outside a GitHub checkout, for a session start
  ${CLI} tokens [set <name>]                          list every keychain:<name> GitHub token the profiles name, marking the ones missing from the macOS keychain, never a value; set <name> asks for the token with echo off and stores it there, where up binds it for containers and the gh on PATH reads it for the repository it runs in; run it yourself
  ${CLI} ls                                           containers with herdr status; branch, dirty count and SHA for each repo
  ${CLI} peek <sandbox> [--lines 40]                  each repo's branch, dirty count, SHA, git status, log, diff, install log and the pane tail
  ${CLI} steer <sandbox> <text...>                    send the container's agent this text
  ${CLI} handoff <sandbox> [--continue]              approve the session handoff the container suggested: its fresh session starts from the task directory, and --continue sends it the stock continue once it is ready for it
  ${CLI} exec <sandbox> -- <command...>               run it in the container workspace; one quoted argument runs as a shell line
  ${CLI} artifacts [--repo <path>]                    each task's files with size and age, its folders folded to one line
  ${CLI} history <sandbox> [--repo <path>]            every status.md change in order: status, attention, summary, the Log lines it added and any it removed
  ${CLI} copy <src> <dst>                             sbx cp; one side is <sandbox>:<path>
  ${CLI} land <sandbox> [--branch <name>] [--sign] [--push]   fetch every repo's branch from the sandbox, preflight all, then move each host branch; signs per profile or with --sign, --push pushes after every repo is signed; a rerun resumes, pushes stay fast-forward; --branch for one repo only
  ${CLI} down <sandbox> [--force]                     write logs/usage.json from the task's sessions and logs/memory.json from the guest's peak and anon memory and its high and oom counts, close the tab, remove the container; a head the container pushed to its origin counts as landed; the task directory stays
  ${CLI} build [--pi|--claude]                        render the container seat and rebuild that agent's image from it, the seat's own without a flag
  ${CLI} render [--seat host|container] [--out <dir>]  render the seat's rules, skills, agents and settings into its home, or a seat into <dir>
  ${CLI} watch [<sandbox>...]                         print a [fleet] line each time a container this pane put up or steered last, or one named, settles; hold it with Monitor
  ${CLI} relay <sandbox> <task dir> -- <args...>      what up types into the tab of a kind that reports its state through a herdr extension: run the container's agent here and hand herdr the state it reports

  <sandbox> is the container name or its herdr agent name, which is the container name cut to 32 characters with a hash when longer
  --repo <path> picks the repository for up, land, artifacts and a history whose container is gone, and defaults to the current directory; up accepts it repeatedly, primary first; multi-repo land uses the recorded primary`;

const BARE = new Set([
	"apply",
	"brief",
	"continue",
	"force",
	"push",
	"sign",
	"pi",
	"claude",
]);

export function flags(
	args: string[],
	allowed: string[],
): { opts: Record<string, string | true | string[]>; rest: string[] } {
	const opts: Record<string, string | true | string[]> = {};
	const rest: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--") {
			rest.push(...args.slice(i + 1));
			break;
		}
		if (!arg.startsWith("--")) {
			rest.push(arg);
			continue;
		}
		const name = arg.slice(2);
		if (!allowed.includes(name))
			throw new Error(`unknown option --${name}\n${usage}`);
		if (BARE.has(name)) {
			opts[name] = true;
			continue;
		}
		const next = args[i + 1];
		if (next === undefined || next.startsWith("--"))
			throw new Error(`missing value for --${name}`);
		const value = args[++i];
		const previous = opts[name];
		const repeatable = name === "repo" || name === "base";
		opts[name] =
			repeatable && typeof previous === "string"
				? [previous, value]
				: repeatable && Array.isArray(previous)
					? [...previous, value]
					: value;
	}
	return { opts, rest };
}

function need(value: string | undefined, what: string): string {
	if (!value) throw new Error(`missing ${what}\n${usage}`);
	return value;
}

function kindOf(
	opts: Record<string, string | true | string[]>,
): AgentName | undefined {
	if (opts.pi && opts.claude)
		throw new Error("--pi and --claude exclude each other");
	return opts.pi ? "pi" : opts.claude ? "claude" : undefined;
}

function sandboxOf(value: string | undefined) {
	return resolveSandbox(need(value, "sandbox"), io);
}

function repoOf(opts: Record<string, string | true | string[]>): string {
	if (Array.isArray(opts.repo))
		throw new Error("--repo may only be repeated for fleet up");
	return resolve(typeof opts.repo === "string" ? opts.repo : process.cwd());
}

const commands: Record<string, (args: string[]) => Promise<void> | void> = {
	async up(args) {
		const { opts, rest } = flags(args, [
			"repo",
			"branch",
			"base",
			"model",
			"memory",
			"cpus",
			"pi",
			"claude",
		]);
		const repos = Array.isArray(opts.repo)
			? opts.repo.map((path) => resolve(path))
			: [repoOf(opts)];
		const bases = opts.base;
		if (Array.isArray(bases) && bases.length !== repos.length)
			throw new Error("repeat --base once for each --repo, in the same order");
		await up(
			{
				repo: repos[0],
				repos: repos.slice(1),
				label: need(rest[0], "label"),
				kind: kindOf(opts),
				branch: opts.branch as string | undefined,
				base:
					typeof bases === "string"
						? bases
						: Array.isArray(bases)
							? bases[0]
							: undefined,
				bases: Array.isArray(bases) ? bases : undefined,
				model: opts.model as string | undefined,
				memory: opts.memory as string | undefined,
				cpus: opts.cpus as string | undefined,
				root,
			},
			io,
		);
	},
	init(args) {
		const { rest } = flags(args, []);
		init({ root, repo: resolve(need(rest[0], "repo")) }, io);
	},
	profile(args) {
		const { opts, rest } = flags(args, ["apply", "brief"]);
		const text = permissions(
			{ root, repo: rest[0] ?? process.cwd(), apply: opts.apply === true, brief: opts.apply === true && opts.brief === true },
			io,
		);
		if (text) io.log(text);
	},
	tokens(args) {
		const { rest } = flags(args, []);
		if (rest[0] === "set") {
			const name = need(rest[1], "<name>");
			io.log(setToken(name, () => askHidden(`GitHub token for keychain:${name}: `), keychain));
			return;
		}
		for (const line of listTokens(loadProfiles(io.read, root, home), keychain)) io.log(line);
	},
	ls(args) {
		flags(args, []);
		io.log(ls(io));
	},
	peek(args) {
		const { opts, rest } = flags(args, ["lines"]);
		io.log(peek(sandboxOf(rest[0]).name, io, Number(opts.lines ?? 40)));
	},
	steer(args) {
		const { rest } = flags(args, []);
		const [sandbox, ...text] = rest;
		steer(sandboxOf(sandbox), need(text.join(" "), "text"), io, root);
	},
	async handoff(args) {
		const { opts, rest } = flags(args, ["continue"]);
		await handoff(sandboxOf(rest[0]), io, {
			continue: opts.continue === true,
			root,
		});
	},
	exec(args) {
		const { rest } = flags(args, []);
		exec(sandboxOf(rest[0]).name, rest.slice(1), io);
	},
	copy(args) {
		const { rest } = flags(args, []);
		copy(need(rest[0], "source"), need(rest[1], "destination"), io);
	},
	artifacts(args) {
		const { opts } = flags(args, ["repo"]);
		io.log(artifacts(repoOf(opts), io));
	},
	history(args) {
		const { opts, rest } = flags(args, ["repo"]);
		io.log(history(need(rest[0], "sandbox"), repoOf(opts), io));
	},
	land(args) {
		const { opts, rest } = flags(args, ["repo", "branch", "sign", "push"]);
		const sandbox = sandboxOf(rest[0]).name;
		const manifest = repositoryManifest(sandbox, io);
		const requested =
			typeof opts.repo === "string" ? resolve(opts.repo) : undefined;
		if (manifest && requested && requested !== manifest.repositories[0].repo)
			throw new Error(
				`${sandbox} belongs to ${manifest.repositories[0].repo}, not ${requested}`,
			);
		land(
			{
				sandbox,
				repo: manifest?.repositories[0].repo ?? repoOf(opts),
				root,
				branch: opts.branch as string | undefined,
				sign: opts.sign === true,
				push: opts.push === true,
			},
			io,
		);
	},
	down(args) {
		const { opts, rest } = flags(args, ["force"]);
		down(sandboxOf(rest[0]).name, { force: opts.force === true }, io);
	},
	build(args) {
		const { opts } = flags(args, ["pi", "claude"]);
		build(root, kindOf(opts), io);
	},
	render(args) {
		const { opts } = flags(args, ["seat", "out"]);
		const seat = opts.seat === "container" ? "container" : "host";
		if (opts.seat !== undefined && opts.seat !== seat)
			throw new Error(`--seat takes host or container, not ${opts.seat}`);
		if (typeof opts.out === "string")
			render({ root, agent: seatOf(io).name, seat, out: resolve(opts.out) }, io);
		else if (seat === "host") renderHost(root, io);
		else throw new Error("the container seat needs --out <dir>");
	},
	async relay(args) {
		const { rest } = flags(args, []);
		const [sandbox, task, ...agentArgs] = rest;
		process.exitCode = await relay(
			need(sandbox, "sandbox"),
			need(task, "task directory"),
			agentArgs,
			io,
		);
	},
	async watch(args) {
		const { rest } = flags(args, []);
		watch(paneScope(io, rest), io);
		await new Promise(() => {});
	},
};

if (process.argv[1] && import.meta.filename === process.argv[1]) {
	const [name, ...rest] = process.argv.slice(2);
	if (!name || ["--help", "-h", "help"].includes(name)) {
		console.log(usage);
		process.exit(0);
	}
	const command = commands[name];
	if (!command) {
		console.error(usage);
		process.exit(2);
	}
	try {
		await command(rest);
	} catch (error) {
		console.error(`${CLI} ${name}: ${(error as Error).message}`);
		process.exit(1);
	}
}
