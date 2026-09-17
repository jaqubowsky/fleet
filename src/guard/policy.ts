export type Decision = { decision: "allow" | "deny"; reason: string };

const allow = (reason: string): Decision => ({ decision: "allow", reason });
const deny = (reason: string): Decision => ({ decision: "deny", reason });

function strings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(strings);
	if (value && typeof value === "object") return Object.values(value).flatMap(strings);

	return [];
}

type Call = { subject: string; outbound: boolean };

function read(tool: string, input: Record<string, unknown>): Call | Decision {
	const text = (key: string): string => (typeof input[key] === "string" ? (input[key] as string) : "");

	if (tool === "Bash") return { subject: text("command"), outbound: false };
	if (["Read", "Edit", "Write", "NotebookEdit"].includes(tool)) return { subject: text("file_path"), outbound: false };
	if (["Grep", "Glob"].includes(tool)) return { subject: `${text("path")} ${text("pattern")}`.trim(), outbound: false };
	if (tool === "WebFetch") return { subject: text("url"), outbound: true };
	if (tool === "WebSearch") return { subject: text("query"), outbound: true };
	if (tool.startsWith("mcp__")) {
		const subject = strings(input).join(" ").trim();

		return subject ? { subject, outbound: true } : allow("MCP call has no string arguments.");
	}

	return deny(`Unknown tool policy: ${tool}`);
}

const SECRET_PATHS = String.raw`(\.ssh|\.config/op|Library/Keychains|\.pi/agent/auth\.json|\.pi/agent/models-store\.json)`;
const HOST_SECRETS = new RegExp(String.raw`(^|[^A-Za-z0-9_./-])/Users/[^/\s]+/${SECRET_PATHS}`);
const HOME_SECRETS = new RegExp(String.raw`(^|[^A-Za-z0-9_./-])(~|\$HOME)/${SECRET_PATHS}`);
const SECRET_MATERIAL = /(sk-ant-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|-----BEGIN\s[A-Z ]*PRIVATE KEY|op:\/\/)/;
const DELEGATED = /(^|[;&|]|&&)\s*sbx\s+(exec|run|cp)(\s|$)/;
const CREDENTIAL_STORE = "Credential store is off limits: ~/.ssh, ~/.config/op and ~/Library/Keychains are read by the human only.";

const START = String.raw`(^|[;&|]|&&|-c\s*['"])\s*([A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(sudo\s+)?\\?`;
const command = (rule: string): RegExp => new RegExp(START + rule);

const PUSH = String.raw`git(\s+-\S+(\s+[^-]\S*)?)*\s+push\b`;
const PROTECTED = String.raw`(~|\$HOME|/Users/[^/\s]+/(Work|Personal|my-knowledge-base|\.pi|\.ssh|\.config)|/(etc|usr|bin|sbin|var|System|Library|Applications|opt))(/|\s|$)`;
const ROOTS = String.raw`(/|/home/bob(/dev)?|/Users/[^/\s]+)(\s|$)`;

const DELEGATED_RULES: [RegExp, string][] = [
	[command(PUSH), "Containers do not push or hold a write credential. Bring the branch home with fleet land and let the human push from this Mac."],
	[command(String.raw`(git\s+commit[^|;&]*(-S\b|--gpg-sign)|git\s+config[^|;&]*gpgsign\s+true)`), "The signing key never enters a container. Signing happens here, on the host."],
];

const BASH_RULES: [RegExp, string][] = [
	[command(String.raw`op\s+(read|item|document|vault|whoami|signin|account)\b`), "1Password is the human's. Secrets reach a sandbox as op:// references through sbx, never through the agent's shell."],
	[command(String.raw`security\s+(find-(generic|internet)-password|export|dump-keychain)`), "The keychain is read by the human only. Ask for the value instead of pulling it out of the store."],
	[command(String.raw`git(\s+-\S+)*\s+commit-tree\b`), "commit-tree makes an unsigned commit behind the signing rule. A refused command is a stop, not a puzzle: ask the human."],
	[command(String.raw`ssh-keygen\s+-Y\s+sign`), "Signing by hand is not how a commit gets signed here; git does it with the key behind Touch ID."],
	[command(`${PUSH}[^|;&]*(--force\\b|--force-with-lease\\b|\\s-f\\b|--delete\\b|--mirror\\b|\\s:\\S+)`), "A force, delete or mirror push rewrites what other people already hold. Touch ID authorises the key, not the history, so this one stays the human's own command."],
	[command(String.raw`(git\s+config[^|;&]*gpgsign\s+(false|no|0)|git[^|;&]*\s-c\s*commit\.gpg[sS]ign=(false|no|0)|git\s+commit[^|;&]*--no-gpg-sign)`), "Every commit on this Mac is signed, and the Touch ID prompt is the evidence a person was here. Turning signing off removes that evidence."],
	[command(String.raw`gh\s+((repo\s+(sync|delete|rename|edit))|(pr\s+(create|merge|close|edit|ready))|(release\s+(create|edit|delete|upload))|(api\s[^|;&]*(-X\s*(POST|PUT|PATCH|DELETE)|--method))|(secret|workflow|ssh-key|gpg-key)\s+(set|delete|add|run|enable|disable)|(gist\s+create))`), "gh writing to the remote is a push by another name. The human opens the PR and runs the release."],
	[command(String.raw`(curl|wget|base64)\b[^|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b`), "Piping a download into a shell is the path this fleet was hardened against. Fetch, verify a checksum, then run."],
	[command(String.raw`(curl|wget)\b[^|]*\|\s*(sudo\s+)?(python3?|node|ruby|perl|php)\s*(-\s*)?($|[;&|)])`), "Piping a download into an interpreter is the path this fleet was hardened against. Fetch, verify a checksum, then run."],
];

const RECURSIVE_RM = command(String.raw`rm\s+(-[A-Za-z0-9]*[rR][A-Za-z0-9]*\s+)*-?[A-Za-z0-9]*[rR]`);
const RM_PROTECTED = command(String.raw`rm\s[^;&|]*\s${PROTECTED}`);
const RM_ROOTS = command(String.raw`rm\s[^;&|]*\s${ROOTS}`);
const ORCHESTRATION = /(^|[;&|]|&&)\s*(sbx|herdr)(\s|$)/;
const SSH = command(String.raw`ssh(\s|$)`);
const SSH_LOCAL = command(String.raw`ssh\s+-(V|G|Q)\b`);
const READ_ONLY_GIT = /(^|[;&|]|&&)\s*git\s+(status|log|diff|show|fetch|ls-remote|ls-files|branch|rev-parse|remote|blame|describe|shortlog)\b/;

const INTERPRETER = /(^|[|;&\t ])((ba|z)?sh|python3?|node|perl|ruby|env)([\t ]|$)/;

function scan(subject: string): string {
	const kept: string[] = [];
	let delim = "";
	let keep = false;

	for (const line of subject.split("\n")) {
		if (delim) {
			if (line.trim() === delim) delim = "";
			else if (keep) kept.push(line);
			continue;
		}

		kept.push(line);
		const at = line.indexOf("<<");
		if (at < 0) continue;

		const rest = line.slice(at + 2).replace(/^-/, "");
		const quote = rest[0];
		if (quote !== "'" && quote !== '"') continue;

		const end = rest.indexOf(quote, 1);
		if (end < 2) continue;

		delim = rest.slice(1, end);
		keep = INTERPRETER.test(line);
	}

	return kept.join("\n");
}

function flatten(subject: string): string {
	return subject.replace(/(sbx\s+(exec|run|cp)\s+\S+|herdr\s+[a-z-]+)/g, ";").replace(/['"]/g, " ");
}

export function decide(tool: string, input: Record<string, unknown>, worker = false): Decision {
	const call = read(tool, input);
	if ("decision" in call) return call;
	if (!call.subject) return deny("Guard policy error: tool input has no policy subject.");

	const subject = call.outbound ? call.subject.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, " ") : call.subject;
	const scanned = scan(subject);
	if (HOST_SECRETS.test(scanned)) return deny(CREDENTIAL_STORE);
	if (HOME_SECRETS.test(scanned) && !DELEGATED.test(subject)) return deny(CREDENTIAL_STORE);
	if (call.outbound && SECRET_MATERIAL.test(call.subject)) {
		return deny("Secret material does not leave this machine in a URL, a search query or an MCP argument. If it is a false positive, the human sends it.");
	}

	if (tool !== "Bash") return allow(`Allowed by ${tool} policy.`);

	const flat = flatten(subject);
	const hit = (rule: RegExp): boolean => rule.test(subject) || rule.test(flat);

	if (worker || DELEGATED.test(subject)) {
		for (const [rule, reason] of DELEGATED_RULES) {
			if (hit(rule)) return deny(reason);
		}
	}

	for (const [rule, reason] of BASH_RULES) {
		if (hit(rule)) return deny(reason);
	}

	if (hit(RECURSIVE_RM)) {
		if (hit(RM_PROTECTED)) return deny("Recursive delete of a protected path. Name a path inside the working tree instead.");
		if (hit(RM_ROOTS)) return deny("Recursive delete of a home or filesystem root.");
	}

	if (ORCHESTRATION.test(subject)) return allow("sbx/herdr orchestration.");
	if (hit(SSH) && !hit(SSH_LOCAL)) return deny("Remote shell access is outside this local-only Pi fleet.");
	if (READ_ONLY_GIT.test(subject)) return allow("Read-only git.");

	return allow("Allowed by Bash policy.");
}
