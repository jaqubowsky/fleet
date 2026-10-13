import { PULL_REQUEST } from "../../extensions/activity.ts";
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

function pullRequestIn(text: string): number | undefined {
	try {
		const { number } = JSON.parse(text);
		if (Number.isSafeInteger(number) && number > 0) return number;
	} catch {}
	return undefined;
}

function forwarding(io: Io, file: string, send: (text: string) => void): () => void {
	let sent: string | undefined;
	return () => {
		const text = io.read(file);
		if (text === undefined || text === sent) return;
		try {
			send(text);
		} catch {
			return;
		}
		sent = text;
	};
}

export async function relay(sandbox: string, task: string, args: string[], io: Io): Promise<number> {
	const file = `${task}/logs/agent-state.json`;
	const agent = sandboxes(io).find((s) => s.name === sandbox)?.kind.name;
	if (!agent) throw new Error(`no fleet container named ${sandbox}`);
	io.remove(file);
	const forwards = [
		forwarding(io, file, (text) => {
			const report = reportIn(text);
			if (report) io.herdrText(["pane", "report-agent", io.pane, "--source", `fleet:${agent}`, "--agent", agent, "--state", report.state, "--seq", String(report.seq), ...(report.message === undefined ? [] : [`--message=${report.message}`])]);
		}),
		forwarding(io, `${task}/${PULL_REQUEST}`, (text) => {
			const number = pullRequestIn(text);
			if (number) io.herdrText(["pane", "report-metadata", io.pane, "--source", "fleet:pr", "--token", `pr=#${number}`]);
		}),
	];
	const reading = setInterval(() => forwards.forEach((forward) => forward()), READ_MS);
	try {
		return await io.launch("sbx", ["run", "--name", sandbox, "-e", "HERDR_ENV=1", "-e", `HERDR_PANE_ID=${io.pane}`, "-e", `HERDR_SOCKET_PATH=${SOCKET}`, "-e", `FLEET_AGENT_STATE=${file}`, "--", ...args]);
	} finally {
		clearInterval(reading);
	}
}
