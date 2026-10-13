const GIT = /^(\S*\/)?git$/;
const GIT_VALUED = new Set([
	"-C",
	"-c",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--config-env",
]);

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
