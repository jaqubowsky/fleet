import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type MutationQueue = <T>(path: string, mutation: () => Promise<T>) => Promise<T>;
type Session = {
	ui: { setEditorText(text: string): void };
	sendMessage(message: object, options: object): Promise<void> | void;
	sendUserMessage(text: string): Promise<void> | void;
};

export const COMMAND = "/session-handoff";
export const COMPLETE = "session handoff complete; fresh session idle";
const CANCELLED = "session handoff cancelled; still in the previous session";

export function suggested(command: string): string {
	return `session handoff suggested; approve with ${command}`;
}

export function withAttention(status: string, text: string): string {
	if (!/^attention: .*$/m.test(status)) throw new Error("status.md needs an attention line before handoff");
	return status.replace(/^attention: .*$/m, () => `attention: ${text}`);
}

export function pointer(taskDirectory: string): string {
	return `Previous task directory: ${JSON.stringify(taskDirectory)}. This is optional background. If the user's next message asks to continue or refers to this task, read its current durable artifacts. For unrelated work, ignore it.`;
}

const queues = new Map<string, Promise<unknown>>();

const localQueue: MutationQueue = async (path, mutation) => {
	const previous = queues.get(path) ?? Promise.resolve();
	const current = previous.catch(() => undefined).then(mutation);
	queues.set(path, current);
	try {
		return await current;
	} finally {
		if (queues.get(path) === current) queues.delete(path);
	}
};

async function sdkQueue(): Promise<MutationQueue> {
	try {
		const sdk = "@earendil-works/pi-coding-agent";
		return (await import(sdk)).withFileMutationQueue ?? localQueue;
	} catch {
		return localQueue;
	}
}

function agentHome(): string {
	const configured = process.env.PI_CODING_AGENT_DIR?.replace(/^~(?=\/|$)/, homedir());
	if (configured) return configured;
	return [join(homedir(), ".pi", "agent"), join(homedir(), ".omp", "agent")].find(existsSync) ?? join(homedir(), ".pi", "agent");
}

export default async function (pi: any, mutationQueue?: MutationQueue) {
	if (!process.env.FLEET_ARTIFACTS || !process.env.SANDBOX_NAME) return;
	const mutate: MutationQueue = mutationQueue ?? (await sdkQueue());
	const taskDirectory = join(process.env.FLEET_ARTIFACTS, process.env.SANDBOX_NAME);
	const statusFile = join(taskDirectory, "status.md");
	const agentDir = agentHome();
	const file = ["settings.json", "config.yml"].map((name) => join(agentDir, name)).find(existsSync) ?? join(agentDir, "settings.json");
	let settings;
	try {
		settings = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
	} catch (cause) {
		throw new Error(`Cannot read session handoff settings: ${file}`, { cause });
	}
	const threshold = settings.sessionHandoff?.suggestAtTokens ?? 250000;
	if (!Number.isSafeInteger(threshold) || threshold <= 0) throw new Error("sessionHandoff.suggestAtTokens must be a positive integer");

	const attention = (text: string) => mutate(statusFile, async () => writeFileSync(statusFile, withAttention(readFileSync(statusFile, "utf8"), text)));

	const start = async (session: Session, prompt: string) => {
		session.ui.setEditorText("");
		await session.sendMessage({ customType: "session-handoff", content: pointer(taskDirectory), display: false }, { triggerTurn: false });
		await attention(COMPLETE);
		if (prompt) await session.sendUserMessage(prompt);
	};

	pi.registerTool({
		name: "session_handoff",
		label: "Session handoff",
		description: `At an appropriate handoff point, keep durable artifacts current, then call session_handoff and end your turn. It records the suggestion in status.md, where the host sees it. The user or the host approves by running ${COMMAND}, which opens a fresh idle session with only hidden optional task-directory context; tell the user that command. You cannot approve it yourself.`,
		parameters: { type: "object", properties: {}, additionalProperties: false },
		concurrency: "exclusive",
		async execute() {
			await attention(suggested(COMMAND));
			return { content: [{ type: "text", text: `Handoff suggested in status.md. The user or the host approves with ${COMMAND}; no session switch started.` }], terminate: true };
		},
	});

	pi.registerCommand("session-handoff", {
		description: "Open a fresh session for this task; text after the command becomes its first prompt",
		handler: async (args: string, ctx: any) => {
			const prompt = args.trim();
			await ctx.waitForIdle();
			let replaced = false;
			const result = await ctx.newSession({
				parentSession: ctx.sessionManager.getSessionFile(),
				withSession: async (replacement: Session) => {
					replaced = true;
					await start(replacement, prompt);
				},
			});
			if (result.cancelled) return attention(CANCELLED);
			if (!replaced) await start({ ui: ctx.ui, sendMessage: (m, o) => pi.sendMessage(m, o), sendUserMessage: (text) => pi.sendUserMessage(text) }, prompt);
		},
	});

	pi.on("before_agent_start", (event: { systemPrompt: string }, ctx: any) => {
		const tokens = ctx.getContextUsage()?.tokens;
		if (tokens == null || tokens < threshold) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\nActive context has reached the configured session handoff threshold. Decide whether the work is at an appropriate handoff point. If it is, keep durable artifacts current, call session_handoff to suggest a fresh session, and end the turn; otherwise continue the work.`,
		};
	});
}
