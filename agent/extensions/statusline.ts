import fs from "node:fs";

const WATCH_TOKENS = 150_000;
const NEAR_DUMB_TOKENS = 200_000;
const DUMB_ZONE_TOKENS = 250_000;
const WINDOW_HALF_PCT = 50;
const WINDOW_HIGH_PCT = 75;
const WINDOW_CRITICAL_PCT = 90;
const DIR_SEGMENTS = 2;
const GIT_SEARCH_DEPTH = 6;
const BRANCH_MAX_LENGTH = 18;
const DETACHED_SHA_LENGTH = 7;
const CODEX_PROVIDER = "openai-codex";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const USAGE_REFRESH_MS = 60_000;
const USAGE_TIMEOUT_MS = 8_000;
const EPOCH_MS_THRESHOLD = 1e12;

const PALETTES: Record<string, Palette> = {
  catppuccin: {
    accent: "#89b4fa", accentInk: "#11111b", ink: "#11111b",
    text: "#cdd6f4", muted: "#7f849c",
    zones: ["#a6e3a1", "#f9e2af", "#fab387", "#f38ba8"],
  },
  dracula: {
    accent: "#bd93f9", accentInk: "#282a36", ink: "#282a36",
    text: "#f8f8f2", muted: "#6272a4",
    zones: ["#50fa7b", "#f1fa8c", "#ffb86c", "#ff5555"],
  },
  tokyonight: {
    accent: "#7aa2f7", accentInk: "#16161e", ink: "#16161e",
    text: "#c0caf5", muted: "#545c7e",
    zones: ["#9ece6a", "#e0af68", "#ff9e64", "#f7768e"],
  },
  gruvbox: {
    accent: "#83a598", accentInk: "#282828", ink: "#282828",
    text: "#ebdbb2", muted: "#928374",
    zones: ["#b8bb26", "#fabd2f", "#fe8019", "#fb4934"],
  },
};

const SEPARATORS: Record<string, Separator> = {
  slant: { open: "", close: "", thin: "" },
  slantBack: { open: "", close: "", thin: "" },
  arrow: { open: "", close: "", thin: "" },
};
const BRANCH_GLYPH = "";
const BOLD = 1;
const DIM = 2;
const DEFAULT_BG = 49;
const RESET = "\x1b[0m";

type Palette = { accent: string; accentInk: string; ink: string; text: string; muted: string; zones: string[] };
type Separator = { open: string; close: string; thin: string };
type Run = { text: string; color: string | null; mods: number[] };
type Segment = { fill: string | null; color: string; runs: Run[] };
type Window = { usedPercent: number; resetsAt?: number; windowSeconds?: number };
type Usage = { windows: Window[]; fetchedAt: number };

const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const fg = (hex: string) => [38, 2, ...rgb(hex)];
const bg = (hex: string | null) => (hex ? [48, 2, ...rgb(hex)] : [DEFAULT_BG]);
const sgr = (...codes: number[]) => `\x1b[${codes.join(";")}m`;

const tokenLevel = (t: number) => (t >= DUMB_ZONE_TOKENS ? 3 : t >= NEAR_DUMB_TOKENS ? 2 : t >= WATCH_TOKENS ? 1 : 0);
const percentLevel = (p: number) => (p >= WINDOW_CRITICAL_PCT ? 3 : p >= WINDOW_HIGH_PCT ? 2 : p >= WINDOW_HALF_PCT ? 1 : 0);

const run = (text: string, color: string | null = null, ...mods: number[]): Run => ({ text, color, mods });
const segment = (fill: string | null, color: string, runs: Run[]): Segment => ({ fill, color, runs });

const renderLine = (segments: Segment[], p: Palette, sep: Separator) => {
  const parts: string[] = [];
  segments.forEach((seg, i) => {
    const prev = segments[i - 1];
    if (seg.fill && !prev?.fill) parts.push(sgr(DEFAULT_BG, ...fg(seg.fill)) + sep.open);
    parts.push(seg.runs.map((r) => sgr(...bg(seg.fill), ...fg(r.color ?? seg.color), ...r.mods) + r.text).join(""));
    const next = segments[i + 1];
    if (seg.fill) {
      parts.push(next?.fill ? sgr(...bg(next.fill), ...fg(seg.fill)) + sep.close : sgr(DEFAULT_BG, ...fg(seg.fill)) + sep.close);
    } else if (next && !next.fill) {
      parts.push(sgr(DEFAULT_BG, ...fg(p.muted), DIM) + sep.thin);
    }
    parts.push(RESET);
  });
  return parts.join("");
};

const visibleWidth = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

const fmtTokens = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n));

const fmtClock = (epoch: number) => {
  const t = new Date(epoch > EPOCH_MS_THRESHOLD ? epoch : epoch * 1000);
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
};

const fmtReset = (epoch: number, long: boolean) => {
  const t = new Date(epoch > EPOCH_MS_THRESHOLD ? epoch : epoch * 1000);
  return long
    ? `${String(t.getDate()).padStart(2, "0")}.${String(t.getMonth() + 1).padStart(2, "0")}`
    : fmtClock(epoch);
};

const fmtDir = (path: string) => {
  const home = process.env.HOME ?? "";
  const inHome = home && (path === home || path.startsWith(home + "/"));
  const parts = (inHome ? path.slice(home.length) : path).split("/").filter(Boolean);
  if (!parts.length) return "~";
  if (parts.length > DIR_SEGMENTS) return `…/${parts.slice(-DIR_SEGMENTS).join("/")}`;
  return (inHome ? "~/" : "/") + parts.join("/");
};

const gitBranch = (startDir: string) => {
  let dir = startDir;
  for (let depth = 0; depth < GIT_SEARCH_DEPTH; depth++) {
    try {
      const marker = `${dir}/.git`;
      let gitDir = marker;
      if (!fs.statSync(marker).isDirectory()) {
        const pointer = fs.readFileSync(marker, "utf8").match(/gitdir:\s*(.+)/);
        if (!pointer) return "";
        gitDir = pointer[1].trim();
      }
      const head = fs.readFileSync(`${gitDir}/HEAD`, "utf8").trim();
      const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
      return ref ? ref[1] : head.slice(0, DETACHED_SHA_LENGTH);
    } catch {}
    const parent = dir.slice(0, dir.lastIndexOf("/"));
    if (!parent || parent === dir) return "";
    dir = parent;
  }
  return "";
};

const parseWindow = (raw: any): Window | undefined => {
  if (typeof raw?.used_percent !== "number") return undefined;
  return {
    usedPercent: raw.used_percent,
    resetsAt: typeof raw.reset_at === "number" ? raw.reset_at : undefined,
    windowSeconds: typeof raw.limit_window_seconds === "number" ? raw.limit_window_seconds : undefined,
  };
};

const windowLabel = (w: Window): string => {
  const s = w.windowSeconds;
  if (!s || s <= 0) return "lim";
  const h = s / 3600;
  return h <= 36 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
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

const buildSegments = (ctx: any, usage: Usage | undefined, p: Palette) => {
  const segments: Segment[] = [];

  const dir: string = ctx.cwd ?? process.cwd();
  segments.push(segment(p.accent, p.accentInk, [run(` ${fmtDir(dir)} `)]));

  const branch = gitBranch(dir);
  if (branch) {
    const label = branch.length > BRANCH_MAX_LENGTH ? `${branch.slice(0, BRANCH_MAX_LENGTH - 1)}…` : branch;
    segments.push(segment(null, p.text, [run(` ${BRANCH_GLYPH} ${label} `)]));
  }

  const model = ctx.model?.name ?? ctx.model?.id;
  if (model) {
    const runs = [run(` ${model} `)];
    if (ctx.thinkingLevel) runs.push(run(`${ctx.thinkingLevel} `, p.muted));
    segments.push(segment(null, p.text, runs));
  }

  const context = ctx.getContextUsage?.();
  const tokens: number = context?.tokens ?? 0;
  const window: number = context?.contextWindow ?? ctx.model?.contextWindow ?? 0;
  const pct = Math.floor(context?.percent ?? (window ? (tokens / window) * 100 : 0));
  const zone = p.zones[Math.max(tokenLevel(tokens), percentLevel(pct))];
  segments.push(segment(zone, p.ink, [run(` ${fmtTokens(tokens)} `, null, BOLD)]));
  segments.push(segment(null, zone, [run(` ${pct}% `)]));

  for (const w of usage?.windows ?? []) {
    const used = Math.round(w.usedPercent);
    const long = !!w.windowSeconds && w.windowSeconds > 36 * 3600;
    const runs = [run(` ${windowLabel(w)} ${used}% `, p.zones[percentLevel(used)])];
    if (w.resetsAt != null) runs.push(run(`↻${fmtReset(w.resetsAt, long)} `, p.text, DIM));
    segments.push(segment(null, p.text, runs));
  }

  return segments;
};

const monitorLine = (): string | undefined => {
  const list = (globalThis as any).__fleetMonitor;
  if (!Array.isArray(list) || !list.length) return undefined;
  const p = PALETTES[process.env.PI_STATUSLINE_PALETTE ?? ""] ?? PALETTES.catppuccin;
  const [green, yellow, orange, red] = p.zones;
  const statusSgr = (s: string) =>
    s === "working" ? sgr(...fg(yellow))
    : s === "blocked" || s === "exited" ? sgr(...fg(red))
    : s === "done" ? sgr(...fg(green))
    : sgr(...fg(p.text), DIM);
  const sep = sgr(...fg(p.text), DIM) + " · " + RESET;
  const body = list
    .map((w: any) => sgr(...fg(p.text)) + w.name + " " + statusSgr(w.status) + w.status + RESET)
    .join(sep);
  return sgr(...fg(orange)) + " ◉ " + sgr(...fg(p.text)) + "watching  " + body + RESET;
};

const statusline = (ctx: any, usage: Usage | undefined, width: number) => {
  const p = PALETTES[process.env.PI_STATUSLINE_PALETTE ?? ""] ?? PALETTES.catppuccin;
  const sep = SEPARATORS[process.env.PI_STATUSLINE_SEPARATOR ?? ""] ?? SEPARATORS.slant;
  const segments = buildSegments(ctx, usage, p);

  let line = renderLine(segments, p, sep);
  while (visibleWidth(line) > width && segments.length > 1) {
    segments.splice(1, 1);
    line = renderLine(segments, p, sep);
  }

  return line;
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
    ctx.ui.setFooter(() => ({
      render(width: number) {
        const mon = monitorLine();
        return mon ? ["", statusline(current, usage, width), mon] : ["", statusline(current, usage, width)];
      },
      invalidate() {},
    }));
  };

  pi.on("session_start", (_event: any, ctx: any) => { install(ctx); void refresh(ctx); });
  pi.on("model_select", (_event: any, ctx: any) => { usage = undefined; void refresh(ctx); });
  pi.on("turn_end", (_event: any, ctx: any) => { void refresh(ctx); });

  pi.registerCommand("clear", {
    description: "Start a new session",
    handler: async (_args: string, ctx: any) => { await ctx.newSession(); },
  });
}
