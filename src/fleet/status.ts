import { addedLines, fieldsOf, logLines } from "../../extensions/status-history.ts";
import type { Io } from "./io.ts";

export type Sandbox = { name: string; status: string; workspaces: string[] };
export type Agent = {
	pane_id: string;
	tab_id?: string;
	workspace_id?: string;
	agent_status?: string;
	name?: string;
	agent?: string | null;
	cwd?: string;
};
export type Row = {
	sandbox: string;
	status: string;
	agent: string;
	branch: string;
	dirty: number;
	stalled?: boolean;
	blocked?: number;
	activity?: string;
	facts?: string;
};

export function fleetSandboxes(
	sbxLs: { sandboxes?: Sandbox[] },
	prefix: string,
): Sandbox[] {
	return (sbxLs.sandboxes ?? []).filter((s) => s.name.startsWith(prefix));
}

export function sandboxes(io: Io): Sandbox[] {
	const text = io.sbx(["ls", "--json"], { quiet: true, timeoutMs: 60_000 });
	let listed: { sandboxes?: Sandbox[] };
	try {
		listed = JSON.parse(text);
	} catch (cause) {
		throw new Error("sbx ls returned invalid JSON", { cause });
	}
	return fleetSandboxes(listed, io.harness.prefix);
}

export function agentFor(agents: Agent[], name: string): Agent | undefined {
	return agents.find((a) => a.name === name);
}

export function parseCheckout(text: string): {
	branch: string;
	dirty: number;
	head: string;
} {
	const [branch = "", dirty = "0", head = ""] = text.trim().split("\t");
	return { branch, dirty: Number(dirty) || 0, head };
}

export const checkoutProbe =
	'cd "$WORKSPACE_DIR" && printf "%s\\t%s\\t%s" "$(git branch --show-current)" "$(git status --porcelain | wc -l | tr -d " ")" "$(git rev-parse HEAD)"';

function bounded(text: string, limit: number): string {
	const compact = text.trim().replace(/\s+/g, " ");
	return compact.length > limit ? `${compact.slice(0, limit - 3)}...` : compact;
}

export function calls(count: number): string {
	return `${count} tool call${count === 1 ? "" : "s"}`;
}

export function formatRows(rows: Row[]): string {
	if (!rows.length) return "no fleet containers";
	const width = Math.max(...rows.map((r) => r.sandbox.length));
	return rows
		.map(
			(r) =>
				`${r.sandbox.padEnd(width)}  ${r.status.padEnd(8)} ${r.agent.padEnd(8)} ${r.branch}${r.dirty ? `  ${r.dirty} uncommitted` : ""}${r.stalled ? "  stalled" : ""}${r.blocked ? `  ${calls(r.blocked)} since blocked` : ""}${r.activity ? `  ${r.activity}` : ""}${r.facts ? `\n  ${r.facts}` : ""}`,
		)
		.join("\n");
}

export const commitsProbe = [
	'cd "$WORKSPACE_DIR" || exit 0',
	'branch="$(git branch --show-current)"',
	'base="$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null)" || { printf "%s" "$branch"; exit 0; }',
	'from="$(git merge-base "$base" HEAD)" || { printf "%s\\t%s" "$branch" "$base"; exit 0; }',
	'pushed="refs/remotes/origin/$branch"',
	'git rev-parse -q --verify "$pushed" >/dev/null || pushed="$from"',
	'printf "%s\\t%s\\t%s\\t%s\\t%s\\t%s" "$branch" "$base" "$(git rev-list --count "$from"..HEAD)" "$(git rev-list --count "$pushed"..HEAD)" "$(git diff --shortstat "$from" HEAD)" "$(git log -1 --format="%h %s" "$from"..HEAD)"',
].join("\n");

export function commitFacts(probed: string): { branch?: string; line: string } {
	const [branch, base, total, unpushed, shortstat = "", latest = ""] = probed.trim().split("\t");
	if (!base) return { branch: branch || undefined, line: "not counted: this clone has no origin/HEAD" };
	if (total === undefined) return { branch, line: `not counted: no merge base with ${base}` };
	if (total === "0") return { branch, line: `none since ${base}` };
	const count = (word: string) => shortstat.match(new RegExp(`(\\d+) ${word}`))?.[1] ?? "0";
	const files = count("files? changed");
	return {
		branch,
		line: `${total} since ${base}, ${Number(total) - Number(unpushed)} pushed, ${unpushed} unpushed, ${files} file${files === "1" ? "" : "s"} +${count("insertions?")} -${count("deletions?")}, latest ${bounded(latest, 80)}`,
	};
}

type Check = { name?: string; context?: string; status?: string; conclusion?: string; state?: string };

const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

export function prFacts(json: string): { line: string; running: boolean } {
	const pr: { number: number; state: string; statusCheckRollup?: Check[] } = JSON.parse(json);
	const state = pr.state.toLowerCase();
	const checks = pr.statusCheckRollup ?? [];
	const pending = checks.filter((c) => (c.status ? c.status !== "COMPLETED" : c.state === "PENDING" || c.state === "EXPECTED"));
	const failed = checks.filter((c) => FAILED.has(c.conclusion || c.state || "")).map((c) => c.name ?? c.context);
	const ci = !checks.length
		? "no CI checks"
		: pending.length
			? `CI running, ${checks.length - pending.length} of ${checks.length} checks done`
			: failed.length
				? `CI failed: ${bounded(failed.join(", "), 120)}`
				: "CI passed";
	return { line: `#${pr.number} ${state}, ${ci}`, running: state === "open" && pending.length > 0 };
}

export function branchFacts(io: Io, sandbox: string, repo: string): { commits: string; pr: string; running: boolean } {
	let commits: ReturnType<typeof commitFacts> = { line: "not counted" };
	try {
		commits = commitFacts(io.sbx(["exec", sandbox, "sh", "-c", commitsProbe], { quiet: true }));
	} catch (error) {
		commits.line = `not counted: ${bounded(String(error), 120)}`;
	}
	let pr = { line: "not read: no branch", running: false };
	if (commits.branch && !/^\w[\w./-]*$/.test(commits.branch)) pr.line = `not read: branch ${bounded(commits.branch, 80)} is not a plain branch name`;
	else if (commits.branch) {
		try {
			pr = prFacts(io.gh(["pr", "view", commits.branch, "--json", "number,state,statusCheckRollup"], repo));
		} catch (error) {
			const message = String(error);
			pr.line = /no pull requests found/.test(message) ? "none" : `not read: ${bounded(message.split("\n").at(-1) ?? message, 120)}`;
		}
	}
	return { commits: commits.line, pr: pr.line, running: pr.running };
}

export function wake(
	statusMd: string | undefined,
	facts: string,
	shown?: string[],
): string {
	const fields = fieldsOf(statusMd);
	const count = addedLines(logLines(statusMd), shown ?? []).length;
	const log = count
		? `\n\nlog: ${count} ${shown ? "new " : ""}${count === 1 ? "entry" : "entries"} in status.md`
		: "";
	return (
		[
			`status: ${bounded(fields.status ?? (statusMd === undefined ? "no status.md" : "not recorded"), 80)}`,
			...(fields.attention && fields.attention !== "none"
				? [`attention: ${bounded(fields.attention, 180)}`]
				: []),
		].join("\n\n") + `${log}\n\n${facts}`
	);
}

export function elapsed(from: Date, to: Date): string {
	const minutes = Math.max(
		0,
		Math.round((to.getTime() - from.getTime()) / 60_000),
	);
	return minutes < 60
		? `${minutes}m`
		: `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
