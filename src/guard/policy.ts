import type { Profile } from "../profile/profile.ts";
import { argvsOf, hostCommands, programs, scan } from "./argv.ts";

export type HostLevels = Pick<
	Profile["host"],
	"push" | "pr" | "merge" | "down"
>;

export type Host = {
	levels: () => HostLevels;
	reaches: (path: string) => boolean;
};

export type Decision = {
	decision: "allow" | "deny";
	reason: string;
	explicit?: true;
};

const allow = (reason: string): Decision => ({ decision: "allow", reason });
const granted = (reason: string): Decision => ({
	decision: "allow",
	reason,
	explicit: true,
});
const PLAIN = /^\s*(git|sbx|herdr)\s[^\n;&|`$()<>]*$/;
const plain = (subject: string, reason: string): Decision =>
	PLAIN.test(subject) ? granted(reason) : allow(reason);
const deny = (reason: string): Decision => ({ decision: "deny", reason });

function strings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(strings);
	if (value && typeof value === "object")
		return Object.values(value).flatMap(strings);

	return [];
}

type Call = { subject: string; outbound: boolean };

export const POLICY_TOOLS = [
	"Bash",
	"Read",
	"Edit",
	"Write",
	"NotebookEdit",
	"Grep",
	"Glob",
	"WebFetch",
	"WebSearch",
	"mcp__.*",
];

function read(tool: string, input: Record<string, unknown>): Call | Decision {
	const text = (key: string): string =>
		typeof input[key] === "string" ? (input[key] as string) : "";

	if (tool === "Bash") return { subject: text("command"), outbound: false };
	if (["Read", "Edit", "Write", "NotebookEdit"].includes(tool))
		return {
			subject: text("file_path") || text("notebook_path"),
			outbound: false,
		};
	if (["Grep", "Glob"].includes(tool))
		return {
			subject: `${text("path")} ${text("pattern")}`.trim(),
			outbound: false,
		};
	if (tool === "WebFetch") return { subject: text("url"), outbound: true };
	if (tool === "WebSearch") return { subject: text("query"), outbound: true };
	if (tool.startsWith("mcp__")) {
		const subject = strings(input).join(" ").trim();

		return subject
			? { subject, outbound: true }
			: allow("MCP call has no string arguments.");
	}

	return deny(`Unknown tool policy: ${tool}`);
}

const SECRET_PATHS = String.raw`(\.ssh|\.config/op|Library/Keychains|\.pi/agent/(auth\.json|models-store\.json|remote/credentials\.json)|\.claude/\.credentials\.json|\.claude\.json)`;
const HOST_SECRETS = new RegExp(
	String.raw`(^|[^A-Za-z0-9_./-])/Users/[^/\s]+/${SECRET_PATHS}`,
);
const HOME_SECRETS = new RegExp(
	String.raw`(^|[^A-Za-z0-9_./-])(~|\$HOME)/${SECRET_PATHS}`,
);
export const SECRET_MATERIAL =
	/(sk-ant-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|-----BEGIN\s[A-Z ]*PRIVATE KEY|op:\/\/)/;
const DELEGATED = /(^|[;&|]|&&)\s*sbx\s+(exec|run|cp)(\s|$)/;
const CREDENTIAL_STORE =
	"Credential store is off limits: ~/.ssh, ~/.config/op and ~/Library/Keychains are read by the human only.";

const START = String.raw`^(\|\s*)?`;
const command = (rule: string): RegExp => new RegExp(START + rule, "m");

const GIT = String.raw`git(\s+-\S+(\s+[^-]\S*)?)*`;
const GIT_AT = String.raw`${START}(\S*/)?${GIT}`;
const PUSH_AT = String.raw`${GIT_AT}\s+push\b`;
const IN_COMMAND = String.raw`(>&|&>|[^|;&\n])*`;
const PROTECTED = String.raw`(~|\$HOME|/Users/[^/\s]+/(Work|Personal|my-knowledge-base|harness|\.pi|\.claude|\.ssh|\.config)|/(etc|usr|bin|sbin|var|System|Library|Applications|opt))(/|\s|$)`;
const ROOTS = String.raw`(/|/Users/[^/\s]+)(\s|$)`;

const GH_WRITE =
	"gh writing to the remote is a push by another name. The human opens the PR and runs the release.";

const BASH_RULES: [RegExp, string][] = [
	[
		command(String.raw`op\s+(read|item|document|vault|whoami|signin|account)\b`),
		"1Password is the human's. Secrets reach a sandbox as op:// references through sbx, never through the agent's shell.",
	],
	[
		command(
			String.raw`security\s+(find-(generic|internet)-password|export|dump-keychain)`,
		),
		"The keychain is read by the human only. Ask for the value instead of pulling it out of the store.",
	],
	[
		command(String.raw`git(\s+-\S+)*\s+commit-tree\b`),
		"commit-tree makes an unsigned commit behind the signing rule. A refused command is a stop, not a puzzle: ask the human.",
	],
	[
		command(String.raw`ssh-keygen\s+-Y\s+sign`),
		"Signing by hand is not how a commit gets signed here; git does it with the key behind Touch ID.",
	],
	[
		new RegExp(
			String.raw`${PUSH_AT}${IN_COMMAND}\s((-\w*[fd]\w*|--(for|de|m|pru)[\w-]*)(?![\w-])|[+:]\S)|${GIT_AT}\s+(-c\s*|config\s${IN_COMMAND})remote\.\S+\.(mirror|push)(?![\w-])`,
			"m",
		),
		"A force, delete or mirror push rewrites what other people already hold. Touch ID authorises the key, not the history, so this one stays the human's own command.",
	],
	[
		command(
			String.raw`(git\s+config[^|;&]*gpgsign\s+(false|no|0)|git[^|;&]*\s-c\s*commit\.gpg[sS]ign=(false|no|0)|git\s+commit[^|;&]*--no-gpg-sign)`,
		),
		"Every commit on this Mac is signed, and the Touch ID prompt is the evidence a person was here. Turning signing off removes that evidence.",
	],
	[
		command(
			String.raw`(\S*/)?gh\s+((repo\s+(sync|delete|rename|edit))|(pr\s+(close|edit|ready))|(release\s+(create|edit|delete|upload))|(api\s[^|;&]*(-X\s*(POST|PUT|PATCH|DELETE)|--method))|(secret|workflow|ssh-key|gpg-key)\s+(set|delete|add|run|enable|disable)|(gist\s+create))`,
		),
		GH_WRITE,
	],
	[
		command(String.raw`(curl|wget|base64)\b[^|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b`),
		"Piping a download into a shell is the path this fleet was hardened against. Fetch, verify a checksum, then run.",
	],
	[
		command(
			String.raw`(curl|wget)\b[^|]*\|\s*(sudo\s+)?(python3?|node|ruby|perl|php)\s*(-\s*)?($|[;&|)])`,
		),
		"Piping a download into an interpreter is the path this fleet was hardened against. Fetch, verify a checksum, then run.",
	],
];

const HOST_PUSH = new RegExp(PUSH_AT, "m");
const OWN_PUSH =
	/^\s*git\s+push(\s+(-u|--set-upstream))?(\s+origin(\s+[\w.][\w./-]*(:[\w.][\w./-]*)?)*)?\s*$/;
const PR_WRITE = command(String.raw`(\S*/)?gh\s+pr\s+(?<action>create|merge)\b`);
const VALUE = String.raw`(\s+|=)("[^"\\$\x60]*"|'[^']*'|[\w./-]+)`;
const OWN_PR: Record<string, RegExp> = {
	create: new RegExp(
		String.raw`^\s*gh\s+pr\s+create(\s+(--fill|--draft|--(title|body|base)${VALUE}))*\s*$`,
	),
	merge: new RegExp(
		String.raw`^\s*gh\s+pr\s+merge(\s+\d+)?(\s+(--(squash|merge|rebase|delete-branch|auto)|--(subject|body)${VALUE}|--match-head-commit(\s+|=)[0-9a-f]{40}))*\s*$`,
	),
};

const OWN_PROFILES =
	"~/.config/harness/repos.json, and host/repos.json in the harness for a repository it omits, set what the host may do, so only the person changes them. Read them with cat, head, jq or grep, or run fleet profile, and ask the person for the change. A command that names either file passes only when every part of it is such a read, so run the read on its own.";
const MAY_NAME_PROFILES =
	"A $variable or glob in this command could expand to ~/.config/harness/repos.json or host/repos.json, which only the person changes, so the guard counts it as naming that file. Spell the paths out, or run any read of them on its own.";
const READS_PROFILES =
	/^\s*(\[|test|cd|cat|head|tail|less|wc|jq|grep|rg|diff|ls|stat|echo|printf|git(\s+-\S+(\s+[^-]\S*)?)*\s+(status|diff|log|show|blame|add|commit))(\s|$)/;
const EXPANSION = /\$\{[^}]*\}|\$\w*|\[[^\]]*\]|\{[^}]*\}/g;
const CD = /(^|[;&|\n(]|&&)\s*(cd|pushd)\s+([^\s;&|)]+)/g;

const RECURSIVE_RM = command(
	String.raw`rm\s+(-[A-Za-z0-9]*[rR][A-Za-z0-9]*\s+)*-?[A-Za-z0-9]*[rR]`,
);
const RM_PROTECTED = command(String.raw`rm\s[^;&|]*\s${PROTECTED}`);
const RM_ROOTS = command(String.raw`rm\s[^;&|]*\s${ROOTS}`);
const ORCHESTRATION = /(^|[;&|]|&&)\s*(sbx|herdr)(\s|$)/;
const SSH = command(String.raw`ssh(\s|$)`);
const SSH_LOCAL = command(String.raw`ssh\s+-(V|G|Q)\b`);
const READ_ONLY_GIT =
	/(^|[;&|]|&&)\s*git\s+(status|log|diff|show|fetch|ls-remote|ls-files|branch|rev-parse|remote|blame|describe|shortlog)\b/;

function literal(text: string): string {
	return text
		.replace(/'[^']*'|\\./g, (quoted) => quoted.replace(/[*?[\]{}$]/g, "\0"))
		.replace(/"[^"]*"/g, (quoted) => quoted.replace(/[*?[\]{}]/g, "\0"))
		.replace(/['"\\]/g, "");
}

function namesProfiles(text: string, host: Host): boolean {
	const plain = literal(text);
	const dirs = ["", ...[...plain.matchAll(CD)].map((match) => match[3])];
	return plain.split(/[\s\x60()=:;<>|&]+/).some((word) => {
		if (word.toLowerCase().includes("repos.json")) return true;

		const pattern = word.replace(EXPANSION, "*");
		const dir = pattern.slice(0, pattern.lastIndexOf("/") + 1);
		const name = pattern.slice(dir.length);
		const glob = new RegExp(
			`^${name
				.replace(/[.+^${}()|[\]\\]/g, "\\$&")
				.replace(/\*/g, ".*")
				.replace(/\?/g, ".")}$`,
			"i",
		);
		if (!/[*?]/.test(name) || !glob.test("repos.json")) return false;

		return (
			/[*?]/.test(dir) ||
			dirs.some(
				(cd) =>
					/[$*?[{]/.test(cd) ||
					host.reaches(`${cd}${cd ? "/" : ""}${dir}repos.json`),
			)
		);
	});
}

function readsProfiles(segment: string, host: Host): boolean {
	const redirects = [...literal(segment).matchAll(/>\|?\s*([^\s;&|<>]+)/g)];
	if (redirects.some(([, target]) => namesProfiles(target, host))) return false;

	return (
		!segment.trim() ||
		/^\s*\d*[<>]/.test(segment) ||
		(READS_PROFILES.test(segment) && !/\s--output\b/.test(segment))
	);
}

export function decide(
	tool: string,
	input: Record<string, unknown>,
	host: Host,
): Decision {
	const call = read(tool, input);
	if ("decision" in call) return call;
	if (!call.subject)
		return deny("Guard policy error: tool input has no policy subject.");

	const subject = call.outbound
		? call.subject.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, " ")
		: call.subject;
	const scanned = scan(subject);
	if (HOST_SECRETS.test(scanned)) return deny(CREDENTIAL_STORE);
	if (HOME_SECRETS.test(scanned) && !DELEGATED.test(subject))
		return deny(CREDENTIAL_STORE);
	if (call.outbound && SECRET_MATERIAL.test(call.subject)) {
		return deny(
			"Secret material does not leave this machine in a URL, a search query or an MCP argument. If it is a false positive, the human sends it.",
		);
	}

	if (
		["Edit", "Write", "NotebookEdit"].includes(tool) &&
		[call.subject, ...call.subject.split(/\s+/).filter(Boolean)].some(
			host.reaches,
		)
	)
		return deny(OWN_PROFILES);
	if (tool !== "Bash") return allow(`Allowed by ${tool} policy.`);

	const run = programs(subject, true).join("\n");
	const hit = (rule: RegExp): boolean => rule.test(run);

	for (const [rule, reason] of BASH_RULES) {
		if (hit(rule)) return deny(reason);
	}

	const segments = hostCommands(scanned);
	if (
		namesProfiles(scanned, host) &&
		!segments.every((segment) => readsProfiles(segment, host))
	)
		return deny(
			/repos\.json/i.test(literal(scanned)) ? OWN_PROFILES : MAY_NAME_PROFILES,
		);

	if (HOST_PUSH.test(programs(subject, false).join("\n"))) {
		const push = host.levels().push;
		if (push === "none")
			return deny(
				"This repository's profile gives the host no push (host.push none in ~/.config/harness/repos.json or host/repos.json). The branch reaches GitHub another way, or the person changes the profile.",
			);
		if (push === "auto" && OWN_PUSH.test(subject))
			return granted("This repository's profile lets the host push.");
	}

	const pr = PR_WRITE.exec(run);
	if (pr) {
		const action = pr.groups?.action ?? "";
		if (
			OWN_PR[action]?.test(subject) &&
			host.levels()[action === "create" ? "pr" : "merge"] === "auto"
		)
			return granted(
				"This repository's profile lets the host open and merge its own pull requests.",
			);
		return deny(
			`${GH_WRITE} Only a plain gh pr create (--fill, --draft, --title, --body, --base) or gh pr merge (a number, --squash, --merge, --rebase, --delete-branch, --auto, --subject, --body, --match-head-commit <full 40-character sha>), each --title, --body, --base or --subject value bare, in single quotes, or in double quotes without \\, $ or a backtick, in a checkout whose only GitHub remote is origin and whose profile gives the host auto for it, runs here.`,
		);
	}

	if (hit(RECURSIVE_RM)) {
		if (hit(RM_PROTECTED))
			return deny(
				"Recursive delete of a protected path. Name a path inside the working tree instead.",
			);
		if (hit(RM_ROOTS))
			return deny("Recursive delete of a home or filesystem root.");
	}

	if (
		argvsOf(subject).some(
			(argv) =>
				(/(?:^|\/)sbx$/.test(argv[0] ?? "") && argv[1] === "rm") ||
				(/(?:^|\/)sh$/.test(argv[0] ?? "") &&
					argv.includes("--") &&
					argv.some((part, i) => part === "sbx" && argv[i + 1] === "rm")),
		)
	)
		return deny(
			"Agents close sandboxes through fleet down; sbx rm bypasses the repository's down permission.",
		);
	if (ORCHESTRATION.test(subject))
		return plain(subject, "sbx/herdr orchestration.");
	if (hit(SSH) && !hit(SSH_LOCAL))
		return deny("Remote shell access is outside this local-only fleet.");
	if (READ_ONLY_GIT.test(subject)) return plain(subject, "Read-only git.");

	return allow("Allowed by Bash policy.");
}
