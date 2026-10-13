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
const NO_VERIFY = /^--no-veri/;
const COMMIT_VALUED = "mFcCtSu";

export type GitCall = { configured: boolean; subcommand: string; args: string[] };

export function gitCall(argv: string[]): GitCall | undefined {
	if (!GIT.test(argv[0] ?? "")) return undefined;
	let configured = false;
	let i = 1;
	while (argv[i]?.startsWith("-")) {
		configured ||= /^(-c|--config-env)/.test(argv[i]);
		i += GIT_VALUED.has(argv[i]) ? 2 : 1;
	}
	return { configured, subcommand: argv[i] ?? "", args: argv.slice(i + 1) };
}

function commitCluster(arg: string): boolean {
	if (!/^-[A-Za-z]+$/.test(arg)) return false;
	for (const letter of arg.slice(1)) {
		if (letter === "n") return true;
		if (COMMIT_VALUED.includes(letter)) return false;
	}
	return false;
}

function skipsHooks({ subcommand, args }: GitCall): boolean {
	return args.some(
		(arg) => NO_VERIFY.test(arg) || (subcommand === "commit" && commitCluster(arg)),
	);
}

export function hooksRefusal(command: string): string | undefined {
	return argvsOf(command)
		.map(gitCall)
		.some((call) => call !== undefined && skipsHooks(call))
		? "--no-verify skips the repository's own hooks, which are its gate. Run the command with them; a hook this environment cannot run gets the substitute the repository names, and a hook that blocks you is reported with what it printed."
		: undefined;
}
