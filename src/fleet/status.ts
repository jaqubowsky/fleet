import { type AgentName, type Kind, KINDS } from "../harness.ts";
import type { Io } from "./io.ts";

export type Sandbox = {
	name: string;
	status: string;
	workspaces: string[];
	kind: Kind;
};
export type Agent = {
	pane_id: string;
	tab_id?: string;
	workspace_id?: string;
	agent_status?: string;
	state_change_seq?: number;
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
	activity?: string;
	facts?: string;
};

export function sandboxes(io: Io): Sandbox[] {
	const text = io.sbx(["ls", "--json"], { quiet: true, timeoutMs: 60_000 });
	let listed: { sandboxes?: (Omit<Sandbox, "kind"> & { agent?: string })[] };
	try {
		listed = JSON.parse(text);
	} catch (cause) {
		throw new Error("sbx ls returned invalid JSON", { cause });
	}
	return (listed.sandboxes ?? []).flatMap(({ agent, ...s }) =>
		agent && Object.hasOwn(KINDS, agent)
			? [{ ...s, kind: KINDS[agent as AgentName] }]
			: [],
	);
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
				`${r.sandbox.padEnd(width)}  ${r.status.padEnd(8)} ${r.agent.padEnd(8)} ${r.branch}${r.dirty ? `  ${r.dirty} uncommitted` : ""}${r.activity ? `  ${r.activity}` : ""}${r.facts ? `\n  ${r.facts}` : ""}`,
		)
		.join("\n");
}

export const commitsProbe = [
	'cd "$WORKSPACE_DIR" || exit 0',
	'branch="$(git branch --show-current)"',
	'base="${FLEET_BASE:-}"; if [ -z "$base" ]; then base="$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null)" || { printf "%s" "$branch"; exit 0; }; fi',
	'from="$(git merge-base "$base" HEAD)" || { printf "%s\\t%s" "$branch" "$base"; exit 0; }',
	'pushed="refs/remotes/origin/$branch"',
	'git rev-parse -q --verify "$pushed" >/dev/null || pushed="$from"',
	'printf "%s\\t%s\\t%s\\t%s\\t%s\\t%s" "$branch" "$base" "$(git rev-list --count "$from"..HEAD)" "$(git rev-list --count "$pushed"..HEAD)" "$(git diff --shortstat "$from" HEAD)" "$(git log -1 --format="%h %s" "$from"..HEAD)"',
].join("\n");

export function commitFacts(probed: string): string {
	const [, base, total, unpushed, shortstat = "", latest = ""] = probed
		.trim()
		.split("\t");
	if (!base) return "not counted: this clone has no origin/HEAD";
	if (total === undefined) return `not counted: no merge base with ${base}`;
	if (total === "0") return `none since ${base}`;
	const count = (word: string) =>
		shortstat.match(new RegExp(`(\\d+) ${word}`))?.[1] ?? "0";
	const files = count("files? changed");
	return `${total} since ${base}, ${Number(total) - Number(unpushed)} pushed, ${unpushed} unpushed, ${files} file${files === "1" ? "" : "s"} +${count("insertions?")} -${count("deletions?")}, latest ${bounded(latest, 80)}`;
}

export function commitsOf(
	io: Io,
	sandbox: string,
	checkout?: { workspace: string; base: string },
): string {
	try {
		return commitFacts(
			io.sbx(
				checkout
					? [
							"exec",
							sandbox,
							"sh",
							"-c",
							`export WORKSPACE_DIR="$1" FLEET_BASE="$2"\n${commitsProbe}`,
							"--",
							checkout.workspace,
							`origin/${checkout.base}`,
						]
					: ["exec", sandbox, "sh", "-c", commitsProbe],
				{ quiet: true },
			),
		);
	} catch (error) {
		return `not counted: ${bounded(String(error), 120)}`;
	}
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
