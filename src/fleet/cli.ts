import { homedir } from "node:os";
import { resolve } from "node:path";
import { harness } from "../harness.ts";
import { render } from "../render/render.ts";
import { artifacts, build, copy, down, exec, ls, peek, renderHost, resolveSandbox, steer } from "./commands.ts";
import { realIo } from "./io.ts";
import { land } from "./land.ts";
import { up } from "./up.ts";
import { watch } from "./watch.ts";

const home = homedir();
const root = process.env.FLEET_ROOT ?? resolve(import.meta.dirname, "../..");
const h = harness(process.env.FLEET_HARNESS);
const io = realIo(home, h);
const cli = h.cli;

const usage = `usage:
  ${cli} up <label> [--branch <name>] [--base <name>] [--model <provider/id:thinking>] [--memory 8g] [--cpus 4]   clone the repo, branch off the freshest remote base, lay out the task directory, start pi in a herdr tab, send nothing
  ${cli} ls                                           containers with herdr status, branch and dirty count
  ${cli} peek <sandbox> [--lines 40]                  git status, log, diff --stat, install log and the pane tail
  ${cli} steer <sandbox> <text...>                    send the container's ${h.agent} this text
  ${cli} exec <sandbox> -- <command...>               run it in the container workspace; one quoted argument runs as a shell line
  ${cli} artifacts [--repo <path>]                    each task's files with size and age, its folders folded to one line
  ${cli} copy <src> <dst>                             sbx cp; one side is <sandbox>:<path>
  ${cli} land <sandbox> [--branch <name>] [--sign] [--push]   import the container branch; --sign covers only what origin lacks, --push stays a fast-forward
  ${cli} down <sandbox> [--force]                     write logs/usage.json from the task's sessions, close the tab, remove the container; the task directory stays
  ${cli} build                                        render the container seat and rebuild ${h.image} from it
  ${cli} render [--seat host|container] [--out <dir>]  render rules, skills, agents and settings into ~/${h.home}, or a seat into <dir>
  ${cli} watch [<sandbox>...]                         print a [fleet] line each time a container settles; hold it with Monitor, persistent: true

  <sandbox> is the container name or its herdr agent name, which is the container name cut to 32 characters with a hash when longer
  --repo <path> picks the repository for up, land and artifacts, and defaults to the current directory`;

const BARE = new Set(["force", "push", "sign"]);

export function flags(args: string[], allowed: string[]): { opts: Record<string, string | true>; rest: string[] } {
	const opts: Record<string, string | true> = {};
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
		if (!allowed.includes(name)) throw new Error(`unknown option --${name}\n${usage}`);
		if (BARE.has(name)) {
			opts[name] = true;
			continue;
		}
		const next = args[i + 1];
		if (next === undefined || next.startsWith("--")) throw new Error(`missing value for --${name}`);
		opts[name] = args[++i];
	}
	return { opts, rest };
}

function need(value: string | undefined, what: string): string {
	if (!value) throw new Error(`missing ${what}\n${usage}`);
	return value;
}

function sandboxOf(value: string | undefined): string {
	return resolveSandbox(need(value, "sandbox"), io);
}

function repoOf(opts: Record<string, string | true>): string {
	return resolve(typeof opts.repo === "string" ? opts.repo : process.cwd());
}

const commands: Record<string, (args: string[]) => Promise<void> | void> = {
	async up(args) {
		const { opts, rest } = flags(args, ["repo", "branch", "base", "model", "memory", "cpus"]);
		await up({ repo: repoOf(opts), label: need(rest[0], "label"), branch: opts.branch as string | undefined, base: opts.base as string | undefined, model: opts.model as string | undefined, memory: opts.memory as string | undefined, cpus: opts.cpus as string | undefined, root }, io);
	},
	ls(args) {
		flags(args, []);
		io.log(ls(io));
	},
	peek(args) {
		const { opts, rest } = flags(args, ["lines"]);
		io.log(peek(sandboxOf(rest[0]), io, Number(opts.lines ?? 40)));
	},
	steer(args) {
		const { rest } = flags(args, []);
		const [sandbox, ...text] = rest;
		steer(sandboxOf(sandbox), need(text.join(" "), "text"), io);
	},
	exec(args) {
		const { rest } = flags(args, []);
		exec(sandboxOf(rest[0]), rest.slice(1), io);
	},
	copy(args) {
		const { rest } = flags(args, []);
		copy(need(rest[0], "source"), need(rest[1], "destination"), io);
	},
	artifacts(args) {
		const { opts } = flags(args, ["repo"]);
		io.log(artifacts(repoOf(opts), io));
	},
	land(args) {
		const { opts, rest } = flags(args, ["repo", "branch", "sign", "push"]);
		land({ sandbox: sandboxOf(rest[0]), repo: repoOf(opts), branch: opts.branch as string | undefined, sign: opts.sign === true, push: opts.push === true }, io);
	},
	down(args) {
		const { opts, rest } = flags(args, ["force"]);
		down(sandboxOf(rest[0]), { force: opts.force === true }, io);
	},
	build(args) {
		flags(args, []);
		build(root, io);
	},
	render(args) {
		const { opts } = flags(args, ["seat", "out"]);
		const seat = opts.seat === "container" ? "container" : "host";
		if (opts.seat !== undefined && opts.seat !== seat) throw new Error(`--seat takes host or container, not ${opts.seat}`);
		if (typeof opts.out === "string") render({ root, harness: h, seat, out: resolve(opts.out) }, io);
		else if (seat === "host") renderHost(root, io);
		else throw new Error("the container seat needs --out <dir>");
	},
	async watch(args) {
		const { rest } = flags(args, []);
		watch(() => (rest.length ? rest : undefined), io);
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
		console.error(`${cli} ${name}: ${(error as Error).message}`);
		process.exit(1);
	}
}
