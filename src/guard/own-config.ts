import { resolve } from "node:path";
import { HARNESSES } from "../harness.ts";
import { argvsOf } from "./argv.ts";
import { within } from "./host.ts";

const HOMES = [HARNESSES.pi, HARNESSES.omp];
const EDITS = new Set(["Edit", "Write"]);
const READS = /^(\S*\/)?(cat|head|tail|less|wc|jq|grep|rg|diff|ls|stat|file|echo|printf|test|\[|cd|pushd)$/;
const REDIRECT = /^\d*(?:&>>?|>&|>>?\|?)/;

export const OWN_CONFIG = "~/.pi and ~/.omp hold the settings, rules, refs, agents and skills the harness renders, so a session never writes there. Change the source in the harness repo; the person renders it home.";

function located(word: string, dir: string, home: string): string {
	return resolve(dir, word.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home));
}

function own(path: string, home: string): boolean {
	return HOMES.some((h) => within(path, `${home}/${h.home}`) && !within(path, `${home}/${h.home}/${h.cache}`));
}

function targets(argv: string[]): { redirected: string[]; named: string[] } {
	const redirected: string[] = [];
	const named: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const op = argv[i].match(REDIRECT);
		if (!op) named.push(argv[i]);
		else if (argv[i].length > op[0].length) redirected.push(argv[i].slice(op[0].length));
		else if (argv[i + 1] !== undefined) redirected.push(argv[++i]);
	}
	return { redirected, named };
}

export function writesOwnConfig(tool: string, input: Record<string, unknown>, cwd: string, home: string): boolean {
	if (EDITS.has(tool)) return String(input.file_path ?? "").split(/\s+/).filter(Boolean).some((path) => own(located(path, cwd, home), home));
	if (tool !== "Bash") return false;
	let dir = cwd;
	return argvsOf(String(input.command ?? "")).some((argv) => {
		const { redirected, named } = targets(argv);
		if (/^(cd|pushd)$/.test(named[0] ?? "")) dir = located(named.find((word, i) => i > 0 && word !== "--") ?? home, dir, home);
		const written = READS.test(named[0] ?? "") ? redirected : [...redirected, ...named.slice(1)];
		return written.some((word) => own(located(word, dir, home), home));
	});
}
