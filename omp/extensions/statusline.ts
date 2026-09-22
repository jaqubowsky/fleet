import { execFile } from "node:child_process";
import { promisify } from "node:util";

const CODEX_PROVIDER = "openai-codex";
const USAGE_STATUS_KEY = "usage";
const CONTEXT_STATUS_KEY = "context";
const USAGE_REFRESH_MS = 60_000;
const USAGE_TIMEOUT_MS = 8_000;
const usageCommand = promisify(execFile);

type Model = { provider?: string; contextWindow?: number };
type ContextUsage = { tokens?: number };
type StatusContext = {
	model?: Model;
	getContextUsage(): ContextUsage | undefined;
	ui: { setStatus(key: string, value: string | undefined): void };
};
type StatusApi = {
	on(event: "session_start" | "model_select" | "turn_end", handler: (event: unknown, ctx: StatusContext) => void): void;
};
type Window = { usedPercent: number; windowSeconds?: number };
type Usage = { windows: Window[]; fetchedAt: number };
type UsagePayload = {
	reports?: Array<{
		provider?: string;
		fetchedAt?: number;
		limits?: Array<{
			amount?: { used?: number };
			window?: { durationMs?: number };
		}>;
	}>;
};

function usageFromPayload(payload: UsagePayload): Usage | undefined {
	const report = payload.reports?.find((candidate) => candidate.provider === CODEX_PROVIDER);
	if (!report?.limits) return undefined;

	const windows = report.limits.flatMap((candidate): Window[] => {
		if (typeof candidate.amount?.used !== "number") return [];
		return [{
			usedPercent: candidate.amount.used,
			windowSeconds: typeof candidate.window?.durationMs === "number" ? candidate.window.durationMs / 1000 : undefined,
		}];
	});
	if (!windows.length) return undefined;
	return { windows, fetchedAt: report.fetchedAt ?? Date.now() };
}

async function fetchUsage(ctx: StatusContext): Promise<Usage | undefined> {
	if (ctx.model?.provider !== CODEX_PROVIDER) return undefined;
	const { stdout } = await usageCommand("omp", ["usage", "--json"], {
		timeout: USAGE_TIMEOUT_MS,
		maxBuffer: 1_000_000,
	});
	return usageFromPayload(JSON.parse(stdout) as UsagePayload);
}

function formatTokens(tokens: number): string {
	if (tokens < 1_000) return String(tokens);
	if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
	return `${(tokens / 1_000_000).toFixed(1)}m`;
}

function updateContext(ctx: StatusContext): void {
	const tokens = ctx.getContextUsage()?.tokens;
	const window = ctx.model?.contextWindow;
	if (typeof tokens !== "number" || typeof window !== "number" || window <= 0) {
		ctx.ui.setStatus(CONTEXT_STATUS_KEY, undefined);
		return;
	}
	ctx.ui.setStatus(CONTEXT_STATUS_KEY, `${formatTokens(tokens)} ${Math.round(tokens / window * 100)}%`);
}

function formatUsage(usage: Usage): string {
	return usage.windows.map((limit) => {
		const hours = (limit.windowSeconds ?? 0) / 3600;
		const label = !hours ? "limit" : hours <= 36 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
		return `${label} ${Math.round(limit.usedPercent)}%`;
	}).join(" · ");
}

export default function statusExtension(pi: StatusApi): void {
	let usage: Usage | undefined;
	let refreshing = false;

	const refresh = async (ctx: StatusContext) => {
		if (ctx.model?.provider !== CODEX_PROVIDER) {
			usage = undefined;
			ctx.ui.setStatus(USAGE_STATUS_KEY, undefined);
			return;
		}
		if (refreshing || usage && Date.now() - usage.fetchedAt < USAGE_REFRESH_MS) {
			ctx.ui.setStatus(USAGE_STATUS_KEY, usage ? formatUsage(usage) : undefined);
			return;
		}

		refreshing = true;
		try {
			usage = await fetchUsage(ctx) ?? usage;
			ctx.ui.setStatus(USAGE_STATUS_KEY, usage ? formatUsage(usage) : undefined);
		} catch {} finally {
			refreshing = false;
		}
	};

	pi.on("session_start", (_event, ctx) => { updateContext(ctx); void refresh(ctx); });
	pi.on("model_select", (_event, ctx) => { usage = undefined; updateContext(ctx); void refresh(ctx); });
	pi.on("turn_end", (_event, ctx) => { updateContext(ctx); void refresh(ctx); });
}
