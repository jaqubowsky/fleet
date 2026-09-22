import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type MutationQueue = <T>(path: string, mutation: () => Promise<T>) => Promise<T>;

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
	const approval = "Approve session handoff";
	let requested = false;
	let approved = false;
	let queued = false;
	let previousAttention = "none";

	const attention = (text: string) => {
		const status = readFileSync(statusFile, "utf8");
		const previous = status.match(/^attention: (.*)$/m)?.[1];
		if (previous === undefined) throw new Error("status.md needs an attention line before handoff");
		writeFileSync(statusFile, status.replace(/^attention: .*$/m, () => `attention: ${text}`));
		return previous;
	};

	pi.on("input", async (event: { text: string; source: string }) => {
		if (event.source === "extension") return;
		await mutate(statusFile, async () => {
			if (!requested || queued) return;
			approved = event.text.trim() === approval;
			if (!approved) {
				attention(previousAttention);
				requested = false;
			}
		});
	});

	pi.registerTool({
		name: "session_handoff",
		label: "Session handoff",
		description: `At an appropriate handoff point, keep durable artifacts current, then call session_handoff to publish a suggestion in status.md and wait. The user or authorized host must reply exactly "${approval}". Call session_handoff again after that explicit approval to queue a fresh session. The new session stays idle with an empty editor and only hidden optional task-directory context.`,
		parameters: { type: "object", properties: {}, additionalProperties: false },
		concurrency: "exclusive",
		async execute() {
			return mutate(statusFile, async () => {
				if (!requested) {
					previousAttention = attention(`session handoff requested; reply "${approval}" to approve`);
					requested = true;
				}
				if (!approved || queued) return { content: [{ type: "text", text: `Handoff suggestion recorded in status.md. Waiting for "${approval}" from the user or authorized host; no session switch started.` }], terminate: true };
				approved = false;
				queued = true;
				pi.sendUserMessage("/session-handoff", { deliverAs: "followUp", expandPromptTemplates: true });
				return { content: [{ type: "text", text: "Approved handoff queued." }], terminate: true };
			});
		},
	});

	pi.registerCommand("session-handoff", {
		description: "Complete a handoff approved through session_handoff",
		handler: async (_args: string, ctx: any) => {
			await ctx.waitForIdle();
			if (!queued) return;
			queued = false;
			requested = false;
			const result = await ctx.newSession({
				parentSession: ctx.sessionManager.getSessionFile(),
				withSession: async (replacementCtx: any) => {
					replacementCtx.ui.setEditorText("");
					await replacementCtx.sendMessage({
						customType: "session-handoff",
						content: `Previous task directory: ${JSON.stringify(taskDirectory)}. This is optional background. If the user's next message asks to continue or refers to this task, read its current durable artifacts. For unrelated work, ignore it.`,
						display: false,
					}, { triggerTurn: false });
					await mutate(statusFile, async () => attention("session handoff complete; fresh session idle"));
				},
			});
			if (result.cancelled) await mutate(statusFile, async () => attention("session handoff cancelled; still in the previous session"));
		},
	});

	pi.on("before_agent_start", (event: { systemPrompt: string }, ctx: any) => {
		const tokens = ctx.getContextUsage()?.tokens;
		if (tokens == null || tokens < threshold) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\nActive context has reached the configured session handoff threshold. Decide whether the work is at an appropriate handoff point. If it is, keep durable artifacts current and use session_handoff to suggest a fresh session and wait for explicit approval; otherwise continue the work.`,
		};
	});
}
