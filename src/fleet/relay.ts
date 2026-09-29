import type { Io } from "./io.ts";
import { sandboxes } from "./status.ts";

const READ_MS = 500;
const SOCKET = "/tmp/herdr.sock";
const STATES = new Set(["working", "blocked", "idle"]);

type Report = { state: string; message?: string; seq: number };

function reportIn(text: string): Report | undefined {
	try {
		const { state, message, seq } = JSON.parse(text);
		if (STATES.has(state) && Number.isSafeInteger(seq) && (message === undefined || typeof message === "string")) return { state, message, seq };
	} catch {}
	return undefined;
}

export async function relay(sandbox: string, task: string, args: string[], io: Io): Promise<number> {
	const file = `${task}/logs/agent-state.json`;
	const agent = sandboxes(io).find((s) => s.name === sandbox)?.kind.name;
	if (!agent) throw new Error(`no fleet container named ${sandbox}`);
	io.remove(file);
	let sent: string | undefined;
	const forward = () => {
		const text = io.read(file);
		if (text === undefined || text === sent) return;
		const report = reportIn(text);
		if (report)
			try {
				io.herdrText(["pane", "report-agent", io.pane, "--source", `fleet:${agent}`, "--agent", agent, "--state", report.state, "--seq", String(report.seq), ...(report.message === undefined ? [] : [`--message=${report.message}`])]);
			} catch {
				return;
			}
		sent = text;
	};
	const reading = setInterval(forward, READ_MS);
	try {
		return await io.launch("sbx", ["run", "--name", sandbox, "-e", "HERDR_ENV=1", "-e", `HERDR_PANE_ID=${io.pane}`, "-e", `HERDR_SOCKET_PATH=${SOCKET}`, "-e", `FLEET_AGENT_STATE=${file}`, "--", ...args]);
	} finally {
		clearInterval(reading);
	}
}
