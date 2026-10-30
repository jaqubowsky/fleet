import { basename } from "node:path";
import type { Io } from "./io.ts";

export const FLEET_LABEL = "fleet=1";
export const SANDBOX_LABEL = "fleet.sandbox";
export const TASK_LABEL = "fleet.task";

export type Terminal = {
	address: string;
	labels: Record<string, string>;
	status: { state: string; app?: string; msg?: string } | null;
	turn?: number;
};

type Space = { id: string; name: string; machine: string | null };

export function fleetTerminals(io: Io): Terminal[] {
	const listed = io.hc<{ terminals?: { address: string }[] }>(["ls", "--label", FLEET_LABEL]).terminals ?? [];
	return listed.map(({ address }) => io.hc<Terminal>(["get", address]));
}

export function terminalOf(sandbox: string, terminals: Terminal[]): Terminal | undefined {
	return terminals.find((t) => t.labels[SANDBOX_LABEL] === sandbox);
}

export function statusOf(terminal: Terminal | undefined): string {
	return terminal ? terminal.status?.state ?? "unknown" : "gone";
}

export function openTab(sandbox: string, task: string, repo: string, args: string[], io: Io): string {
	const argv = JSON.stringify(["exec", "sbx", "run", "--name", sandbox, ...(args.length ? ["--", ...args] : [])]);
	const label = basename(repo);
	const space = io
		.app<{ spaces?: Space[] }>(["ls"])
		.spaces?.find((s) => !s.machine && s.name.toLowerCase() === label.toLowerCase());
	const { terminal } = space
		? io.app<{ terminal?: string }>(["do", "tab.new", "--space", space.id, "--name", sandbox, "--folder", repo, "--argv", argv])
		: io.app<{ terminal?: string }>(["do", "space.new", "--name", label, "--folder", repo, "--tab", sandbox, "--argv", argv]);
	if (!terminal) throw new Error(`herdr-app opened no terminal for ${sandbox}; is the Herdr app window open?`);
	io.hc(["label", terminal, FLEET_LABEL, `${SANDBOX_LABEL}=${sandbox}`, `${TASK_LABEL}=${task}`]);
	io.hc(["keep", terminal, "--off"]);
	return terminal;
}
