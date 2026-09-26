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
	activity?: string;
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

function sectionOf(
	statusMd: string | undefined,
	name: string,
): string | undefined {
	return statusMd
		?.replace(/\r\n/g, "\n")
		.split(/^## /m)
		.find((part) => part.startsWith(`${name}\n`))
		?.slice(name.length + 1);
}

export function fieldsOf(statusMd: string | undefined): {
	status?: string;
	attention?: string;
	summary?: string;
	next?: string;
} {
	const header = (name: string) =>
		statusMd?.match(new RegExp(`^${name}: (.*)$`, "m"))?.[1];
	const section = (name: string) =>
		sectionOf(statusMd, name)?.trim() || undefined;
	return {
		status: header("status"),
		attention: header("attention"),
		summary: section("Summary"),
		next: section("Next step"),
	};
}

export function logLines(statusMd: string | undefined): string[] {
	return (
		sectionOf(statusMd, "Log")
			?.split("\n")
			.filter((line) => line.startsWith("- ")) ?? []
	);
}

export function addedLines(lines: string[], before: string[]): string[] {
	const left = new Map<string, number>();
	for (const line of before) left.set(line, (left.get(line) ?? 0) + 1);
	return lines.filter((line) => {
		const count = left.get(line) ?? 0;
		if (count) left.set(line, count - 1);
		return !count;
	});
}

export function brief(statusMd: string | undefined): string {
	const fields = fieldsOf(statusMd);
	return [
		`status: ${bounded(fields.status ?? (statusMd === undefined ? "no status.md" : "not recorded"), 80)}`,
		`attention: ${bounded(fields.attention ?? "not recorded", 300)}`,
		`summary: ${bounded(fields.summary ?? "not recorded", 600)}`,
		`next step: ${bounded(fields.next ?? "not recorded", 300)}`,
	].join("\n");
}

export function formatRows(rows: Row[]): string {
	if (!rows.length) return "no fleet containers";
	const width = Math.max(...rows.map((r) => r.sandbox.length));
	return rows
		.map(
			(r) =>
				`${r.sandbox.padEnd(width)}  ${r.status.padEnd(8)} ${r.agent.padEnd(8)} ${r.branch}${r.dirty ? `  ${r.dirty} uncommitted` : ""}${r.activity ? `  ${r.activity}` : ""}`,
		)
		.join("\n");
}

export const commitsProbe =
	'cd "$WORKSPACE_DIR" && base="$(git rev-parse --abbrev-ref --symbolic-full-name "@{upstream}" 2>/dev/null)" || exit 0; git log --oneline "$base"..HEAD 2>/dev/null | head -1';

export function wake(
	statusMd: string | undefined,
	commits: string,
	shown?: string[],
): string {
	const fields = fieldsOf(statusMd);
	const count = addedLines(logLines(statusMd), shown ?? []).length;
	const log = count
		? `\n\nlog: ${count} ${shown ? "new " : ""}${count === 1 ? "entry" : "entries"} in status.md`
		: "";
	const commit = commits.split("\n").find((line) => line.trim());
	return (
		[
			`status: ${bounded(fields.status ?? (statusMd === undefined ? "no status.md" : "not recorded"), 80)}`,
			...(fields.attention && fields.attention !== "none"
				? [`attention: ${bounded(fields.attention, 180)}`]
				: []),
			`next step: ${bounded(fields.next ?? "not recorded", 180)}`,
		].join("\n\n") +
		`${log}\n\ncommits: ${commit ? bounded(commit, 120) : "none"}`
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
