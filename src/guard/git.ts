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

const ONE_LINE = /^[a-z]+(\([^()\s]+\))?!?: [^A-Z\s](.*[^.\s])?$/;

function longOption(arg: string, name: string): boolean {
	const key = arg.split("=")[0];
	return key.length > 2 && `--${name}`.startsWith(key);
}

function commitMessages(args: string[]): string[] | undefined {
	const messages: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (["file", "signoff", "trailer"].some((name) => longOption(arg, name))) return undefined;
		if (longOption(arg, "message"))
			messages.push(arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : (args[++i] ?? ""));
		else if (/^-[^-]/.test(arg))
			for (const [at, letter] of [...arg.slice(1)].entries()) {
				if (letter === "F" || letter === "s") return undefined;
				if (letter === "m") {
					const attached = arg.slice(at + 2);
					messages.push(attached === "" ? (args[++i] ?? "") : attached);
					break;
				}
				if (COMMIT_VALUED.includes(letter)) break;
			}
	}
	return messages;
}

export function commitFormatRefusal(command: string): string | undefined {
	const bad = argvsOf(command)
		.map(gitCall)
		.filter((call) => call?.subcommand === "commit")
		.some((call) => {
			const messages = commitMessages(call!.args);
			if (messages === undefined) return true;
			if (messages.length === 0) return false;
			return messages.length > 1 || !ONE_LINE.test(messages[0]);
		});
	return bad
		? "A commit message is one line, `type(scope): subject`: a conventional type, an optional scope, a lowercase imperative subject with no trailing period, and no body or trailer. Pass it as one literal `-m`."
		: undefined;
}
