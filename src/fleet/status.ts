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

export function brief(statusMd: string | undefined): string {
	if (statusMd === undefined) return "status: no status.md";
	const lines = statusMd.split("\n");
	const header = lines.filter((l) => /^(status|attention|now): /.test(l)).join(" | ");
	const last = lines.filter((l) => l.startsWith("- ")).at(-1)?.slice(2) ?? "nothing yet";
	return `${header}\nlast: ${last}`;
}

export function formatRows(rows: Row[]): string {
	if (!rows.length) return "no fleet containers";
	const width = Math.max(...rows.map((r) => r.sandbox.length));
	return rows
		.map((r) => `${r.sandbox.padEnd(width)}  ${r.status.padEnd(8)} ${r.agent.padEnd(8)} ${r.branch}${r.dirty ? `  ${r.dirty} uncommitted` : ""}${r.age ? `  ${r.age}` : ""}${r.cost ? `  ${r.cost}` : ""}`)
		.join("\n");
}

export const commitsProbe = 'cd "$WORKSPACE_DIR" && base="$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)" && git log --oneline "$base"..HEAD 2>/dev/null | head -5';

export function verdict(reviewMd: string | undefined): string | undefined {
	return reviewMd?.split("\n").find((l) => l.startsWith("Verdict: "))?.slice(9);
}

export function wake(statusMd: string | undefined, reviewMd: string | undefined, commits: string): string {
	const lines = [brief(statusMd), `commits: ${commits.trim().split("\n").filter(Boolean).join("; ") || "none"}`];
	const v = verdict(reviewMd);
	if (v) lines.push(`review: ${v}`);
	return lines.join("\n");
}

export function elapsed(from: Date, to: Date): string {
	const minutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
	return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
