export type Sandbox = { name: string; status: string; workspaces: string[] };
export type Agent = { pane_id: string; tab_id?: string; workspace_id?: string; agent_status?: string; name?: string; agent?: string | null; cwd?: string };
export type Row = { sandbox: string; status: string; agent: string; branch: string; dirty: number; age?: string; cost?: string };

export function fleetSandboxes(sbxLs: { sandboxes?: Sandbox[] }): Sandbox[] {
	return (sbxLs.sandboxes ?? []).filter((s) => s.name.startsWith("pi-"));
}

export function agentFor(agents: Agent[], name: string): Agent | undefined {
	return agents.find((a) => a.name === name);
}

export function parseCheckout(text: string): { branch: string; dirty: number; head: string } {
	const [branch = "", dirty = "0", head = ""] = text.trim().split("\t");
	return { branch, dirty: Number(dirty) || 0, head };
}

export const checkoutProbe = 'cd "$WORKSPACE_DIR" && printf "%s\\t%s\\t%s" "$(git branch --show-current)" "$(git status --porcelain | wc -l | tr -d " ")" "$(git rev-parse HEAD)"';

function bounded(text: string, limit: number): string {
	const compact = text.trim().replace(/\s+/g, " ");
	return compact.length > limit ? `${compact.slice(0, limit - 3)}...` : compact;
}

export function brief(statusMd: string | undefined): string {
	const sections = statusMd?.replace(/\r\n/g, "\n").split(/^## /m) ?? [];
	const section = (name: string) => sections.find((part) => part.startsWith(`${name}\n`))?.slice(name.length + 1).trim() || "not recorded";
	return [
		`status: ${bounded(statusMd?.match(/^status: (.*)$/m)?.[1] ?? (statusMd === undefined ? "no status.md" : "not recorded"), 80)}`,
		`attention: ${bounded(statusMd?.match(/^attention: (.*)$/m)?.[1] ?? "not recorded", 300)}`,
		`summary: ${bounded(section("Summary"), 600)}`,
		`next step: ${bounded(section("Next step"), 300)}`,
	].join("\n");
}

export function formatRows(rows: Row[]): string {
	if (!rows.length) return "no fleet containers";
	const width = Math.max(...rows.map((r) => r.sandbox.length));
	return rows
		.map((r) => `${r.sandbox.padEnd(width)}  ${r.status.padEnd(8)} ${r.agent.padEnd(8)} ${r.branch}${r.dirty ? `  ${r.dirty} uncommitted` : ""}${r.age ? `  ${r.age}` : ""}${r.cost ? `  ${r.cost}` : ""}`)
		.join("\n");
}

export const commitsProbe = 'cd "$WORKSPACE_DIR" && base="$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)" && git log --oneline "$base"..HEAD 2>/dev/null | head -5';

export function wake(statusMd: string | undefined, commits: string): string {
	const recent = commits.split("\n").filter((line) => line.trim()).slice(0, 5).map((line) => bounded(line, 120));
	return `${brief(statusMd)}\ncommits: ${recent.join("; ") || "none"}`;
}

export function elapsed(from: Date, to: Date): string {
	const minutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
	return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
