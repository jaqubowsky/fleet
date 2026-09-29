import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { snapshot } from "./status-history.ts";

type MutationQueue = <T>(path: string, mutation: () => Promise<T>) => Promise<T>;
type Session = {
	ui: { setEditorText(text: string): void };
	sendMessage(message: object, options: object): Promise<void> | void;
	sendUserMessage(text: string): Promise<void> | void;
};

export const COMPLETE = "session handoff complete; fresh session idle";
const CANCELLED = "session handoff cancelled; still in the previous session";

export const SUGGESTED = "session handoff suggested";

export function withAttention(status: string, text: string): string {
	if (!/^attention: .*$/m.test(status)) throw new Error("status.md needs an attention line before handoff");
	return status.replace(/^attention: .*$/m, () => `attention: ${text}`);
}

export function contextNote(level: number): string {
	return `The context has passed ${level} tokens, and every turn now reads all of it again: suggest a session handoff at the next natural break, as your Session handoff rule describes.`;
}

export function reminderLevel(tokens: number, threshold: number): number | undefined {
	return tokens < threshold ? undefined : threshold + Math.floor((tokens - threshold) / 100_000) * 100_000;
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
	return join(homedir(), ".pi", "agent");
}

export default async function (pi: any, mutationQueue?: MutationQueue) {
	if (!process.env.FLEET_ARTIFACTS || !process.env.SANDBOX_NAME) return;
	const mutate: MutationQueue = mutationQueue ?? (await sdkQueue());
	const taskDirectory = join(process.env.FLEET_ARTIFACTS, process.env.SANDBOX_NAME);
	const statusFile = join(taskDirectory, "status.md");
	const agentDir = agentHome();
	const file = join(agentDir, "settings.json");
	let settings;
	try {
		settings = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
	} catch (cause) {
		throw new Error(`Cannot read session handoff settings: ${file}`, { cause });
	}
	const threshold = settings.sessionHandoff?.suggestAtTokens ?? 250000;
	if (!Number.isSafeInteger(threshold) || threshold <= 0) throw new Error("sessionHandoff.suggestAtTokens must be a positive integer");

	const attention = (text: string) =>
		mutate(statusFile, async () => {
			writeFileSync(statusFile, withAttention(readFileSync(statusFile, "utf8"), text));
			snapshot(taskDirectory);
		});

	const start = async (session: Session, prompt: string) => {
		session.ui.setEditorText("");
		await session.sendMessage({ customType: "session-handoff", content: pointer(taskDirectory), display: false }, { triggerTurn: false });
		await attention(COMPLETE);
		if (prompt) await session.sendUserMessage(prompt);
	};

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

	let reminded = 0;
	pi.on("turn_end", (_event: unknown, ctx: any) => {
		const tokens = ctx.getContextUsage()?.tokens;
		if (tokens == null) return;
		const level = reminderLevel(tokens, threshold);
		if (level === undefined) {
			reminded = 0;
			return;
		}
		if (level <= reminded) return;
		reminded = level;
		pi.sendMessage({ customType: "session-handoff", content: contextNote(level), display: false }, { deliverAs: "steer" });
	});
}
