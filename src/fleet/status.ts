export type Sandbox = { name: string; status: string; workspaces: string[] };
export type Agent = { pane_id: string; tab_id?: string; workspace_id?: string; agent_status?: string; name?: string; agent?: string | null; cwd?: string };
export type Row = { sandbox: string; status: string; agent: string; branch: string; dirty: number };

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
	const header = lines.filter((l) => /^(status|attention|commit|pr): /.test(l)).join(" | ");
	const next = lines.find((l) => l.startsWith("- [ ] "))?.slice(6) ?? "nothing left";
	return `${header}\nnext: ${next}`;
}

export function formatRows(rows: Row[]): string {
	if (!rows.length) return "no fleet containers";
	const width = Math.max(...rows.map((r) => r.sandbox.length));
	return rows
		.map((r) => `${r.sandbox.padEnd(width)}  ${r.status.padEnd(8)} ${r.agent.padEnd(8)} ${r.branch}${r.dirty ? `  ${r.dirty} uncommitted` : ""}`)
		.join("\n");
}
