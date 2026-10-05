import { type Status, statusline, watching, type Window } from "../src/statusline/statusline.ts";

const CODEX_PROVIDER = "openai-codex";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const USAGE_REFRESH_MS = 60_000;
const USAGE_TIMEOUT_MS = 8_000;

type Usage = { windows: Window[]; fetchedAt: number };

const parseWindow = (raw: any): Window | undefined => {
  if (typeof raw?.used_percent !== "number") return undefined;
  return {
    usedPercent: raw.used_percent,
    resetsAt: typeof raw.reset_at === "number" ? raw.reset_at : undefined,
    seconds: typeof raw.limit_window_seconds === "number" ? raw.limit_window_seconds : undefined,
  };
};

const fetchUsage = async (ctx: any): Promise<Usage | undefined> => {
  const model = ctx.model;
  if (model?.provider !== CODEX_PROVIDER) return undefined;

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth?.ok) return undefined;

  const headers: Record<string, string> = { ...(auth.headers ?? {}) };
  if (!headers.Authorization && !headers.authorization && auth.apiKey) headers.Authorization = `Bearer ${auth.apiKey}`;
  if (!headers["User-Agent"]) headers["User-Agent"] = "pi-statusline";

  const response = await fetch(CODEX_USAGE_URL, { headers, signal: AbortSignal.timeout(USAGE_TIMEOUT_MS) });
  if (!response.ok) return undefined;

  const payload: any = await response.json();
  const rl = payload?.rate_limit ?? {};
  const raws = [rl.primary_window, rl.secondary_window, ...(Array.isArray(payload?.additional_rate_limits) ? payload.additional_rate_limits.map((a: any) => a?.rate_limit) : [])];
  const windows = raws.map(parseWindow).filter((w): w is Window => !!w);
  return { windows, fetchedAt: Date.now() };
};

const status = (ctx: any, usage: Usage | undefined, statuses: Map<string, string>): Status => {
  const context = ctx.getContextUsage?.();
  const tokens: number = context?.tokens ?? 0;
  const window: number = context?.contextWindow ?? ctx.model?.contextWindow ?? 0;
  return {
    dir: ctx.cwd ?? process.cwd(),
    model: ctx.model?.name ?? ctx.model?.id,
    effort: ctx.thinkingLevel,
    tokens,
    percent: context?.percent ?? (window ? (tokens / window) * 100 : 0),
    windows: usage?.windows ?? [],
    remote: statuses.get("pi-remote"),
  };
};

export default function (pi: any) {
  let current: any;
  let usage: Usage | undefined;
  let refreshing = false;

  const refresh = async (ctx: any) => {
    current = ctx;
    if (refreshing || (usage && Date.now() - usage.fetchedAt < USAGE_REFRESH_MS)) return;

    refreshing = true;
    try {
      usage = (await fetchUsage(ctx)) ?? usage;
    } catch {} finally {
      refreshing = false;
    }
  };

  const install = (ctx: any) => {
    current = ctx;
    if (!ctx.hasUI) return;
    ctx.ui.setFooter((_tui: any, _theme: any, footerData: any) => ({
      render(width: number) {
        const statuses = footerData.getExtensionStatuses();
        const fleet = statuses.get("fleet");
        const line = statusline(status(current, usage, statuses), { width });
        return fleet ? [line, watching(fleet)] : [line];
      },
      invalidate() {},
    }));
  };

  pi.on("session_start", (_event: any, ctx: any) => { install(ctx); void refresh(ctx); });
  pi.on("model_select", (_event: any, ctx: any) => { usage = undefined; void refresh(ctx); });
  pi.on("turn_end", (_event: any, ctx: any) => { void refresh(ctx); });
}
