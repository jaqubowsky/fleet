import { resolve } from "node:path";
import { type AgentName, KINDS } from "../harness.ts";
import { argvsOf, redirections } from "./argv.ts";
import { within } from "./host.ts";

const HOMES = Object.values(KINDS);
const RUNTIME: Record<AgentName, string[]> = { pi: [], claude: ["projects", "todos"] };
const EDITS = new Set(["Edit", "Write"]);
const READS = /^(\S*\/)?(cat|head|tail|less|wc|jq|grep|rg|diff|ls|stat|file|readlink|realpath|echo|printf|test|\[|cd|pushd)$/;
const WRITES = /^(\S*\/)?(cp|mv|rm|rmdir|tee|touch|mkdir|ln|chmod|chown|install|rsync|dd|truncate|unlink)$/;
const IN_PLACE = /^(\S*\/)?(sed|perl)$/;

const READERS = "Read, Grep and Glob tools, or cat, head, tail, less, wc, jq, grep, rg, diff, ls, stat, file, readlink or realpath";
export const OWN_CONFIG = `~/.pi and ~/.claude hold the settings, rules, refs, agents and skills the harness renders from its repo, so a write there skips git and the other harness, and the next render overwrites it. Change the source in the harness repo; the person renders it home. To read there, use the ${READERS}.`;
export const OWN_CONFIG_UNREAD = `This command names a path in ~/.pi or ~/.claude, which the harness renders from its repo, and the guard cannot tell whether it writes there. Approve it if it only reads. To read without a question, use the ${READERS}.`;

type OwnConfig = "deny" | "ask" | undefined;

function located(word: string, dir: string, home: string): string {
	return resolve(dir, word.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home));
}

function own(path: string, home: string): boolean {
	return HOMES.some((h) => within(path, `${home}/${h.home}`) && !RUNTIME[h.name].some((state) => within(path, `${home}/${h.home}/${state}`)));
}

function writes(named: string[]): boolean {
	const [program = "", ...rest] = named;
	return WRITES.test(program) || (IN_PLACE.test(program) && rest.some((word) => /^-\w*i/.test(word)));
}

export function ownConfig(tool: string, input: Record<string, unknown>, cwd: string, home: string): OwnConfig {
	if (EDITS.has(tool)) return String(input.file_path ?? "").split(/\s+/).filter(Boolean).some((path) => own(located(path, cwd, home), home)) ? "deny" : undefined;
	if (tool !== "Bash") return undefined;
	let dir = cwd;
	let verdict: OwnConfig;
	for (const argv of argvsOf(String(input.command ?? ""))) {
		const { redirected, named } = redirections(argv);
		if (/^(cd|pushd)$/.test(named[0] ?? "")) dir = located(named.find((word, i) => i > 0 && word !== "--") ?? home, dir, home);
		const inHome = (word: string) => own(located(word, dir, home), home);
		if (redirected.some(inHome)) return "deny";
		if (READS.test(named[0] ?? "") || !named.slice(1).some(inHome)) continue;
		if (writes(named)) return "deny";
		verdict = "ask";
	}
	return verdict;
}
