import { execFileSync } from "node:child_process";
import { argvsOf } from "./argv.ts";

const GIT = /^(\S*\/)?git$/;
const GIT_VALUED = new Set([
	"-C",
	"-c",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--config-env",
]);
const PUSH_VALUED = new Set([
	"-o",
	"--push-option",
	"--receive-pack",
	"--exec",
]);
const EVERY_BRANCH = /^--(all|branches|mirror)$/;
const MOVES_TARGET = /^(switch|checkout|symbolic-ref|config|branch|remote)$/;
const SUBSTITUTED = /\$\(|\x60|(^|[\s|;&])xargs\s/;
const EVERYTHING = "*";

function git(cwd: string, ...args: string[]): string | undefined {
	try {
		return execFileSync("git", ["-C", cwd, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return undefined;
	}
}

type GitCall = { configured: boolean; subcommand: string; args: string[] };

function gitCall(argv: string[]): GitCall | undefined {
	if (!GIT.test(argv[0] ?? "")) return undefined;
	let configured = false;
	let i = 1;
	while (argv[i]?.startsWith("-")) {
		configured ||= /^(-c|--config-env)/.test(argv[i]);
		i += GIT_VALUED.has(argv[i]) ? 2 : 1;
	}
	return { configured, subcommand: argv[i] ?? "", args: argv.slice(i + 1) };
}

function destinations(
	args: string[],
	current: string,
	implicit: string,
): string[] {
	const positional: string[] = [];
	let remoteNamed = false;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (EVERY_BRANCH.test(arg)) return [EVERYTHING];
		if (arg === "--") {
			positional.push(...args.slice(i + 1));
			break;
		}
		if (arg === "--repo") i++;
		if (arg.startsWith("--repo")) remoteNamed = true;
		else if (PUSH_VALUED.has(arg)) i++;
		else if (!arg.startsWith("-")) positional.push(arg);
	}
	const refspecs = remoteNamed ? positional : positional.slice(1);
	if (!refspecs.length) return [implicit];
	return refspecs.map((spec) => {
		const plain = spec.replace(/^\+/, "");
		const target = plain.includes(":")
			? plain.slice(plain.indexOf(":") + 1)
			: plain;
		if (target.includes("*")) return EVERYTHING;
		return target === "HEAD" || target === "@"
			? current
			: target.replace(/^(refs\/)?heads\//, "");
	});
}

export function pushRefusal(
	command: string,
	cwd: string,
	mode?: "host-only",
): string | undefined {
	const argvs = argvsOf(command);
	const calls = argvs.map(gitCall).filter((call) => call !== undefined);
	const pushes = calls.filter((call) => call.subcommand === "push");
	const pushArgvs = argvs.filter((argv) => gitCall(argv)?.subcommand === "push");
	if (!pushes.length) return undefined;
	if (mode === "host-only")
		return "Two-repository container pushes stay on the host; request a separate fleet land --push approval.";
	if (
		SUBSTITUTED.test(command) ||
		pushes.some((push) => push.configured) ||
		pushArgvs.some((argv) => argv.some((word) => word.includes("$"))) ||
		calls.some((call) => MOVES_TARGET.test(call.subcommand))
	)
		return "The guard cannot tell where this push goes: the same command computes its target, sets git config or moves HEAD. Run the push on its own line, with the branch spelled out: `git push -u origin <your branch>`.";
	const base = git(cwd, "rev-parse", "--abbrev-ref", "origin/HEAD")?.replace(
		/^origin\//,
		"",
	);
	if (!base)
		return "This clone has no origin/HEAD, so the guard cannot tell origin's default branch and refuses every push. Run `git remote set-head origin --auto`, then push again.";
	const current = git(cwd, "branch", "--show-current") ?? "";
	const implicit =
		git(cwd, "rev-parse", "--symbolic-full-name", "@{push}")?.replace(
			/^refs\/remotes\/[^/]+\//,
			"",
		) ?? current;
	if (
		!pushes.some(({ args }) =>
			destinations(args, current, implicit).some(
				(target) => target === EVERYTHING || target === base,
			),
		)
	)
		return undefined;
	return `A container never pushes to origin's default branch ${base}, whatever push level the profile gives it: work reaches ${base} through a pull request. ${current && current !== base ? `Push your own branch: \`git push -u origin ${current}\`.` : "Switch to your own branch first: `git switch -c <name>`, named after the task."}`;
}
