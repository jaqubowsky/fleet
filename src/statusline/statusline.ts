import fs from "node:fs";

const WATCH_TOKENS = 150_000;
const NEAR_DUMB_TOKENS = 200_000;
const DUMB_ZONE_TOKENS = 250_000;
const WINDOW_HALF_PCT = 50;
const WINDOW_HIGH_PCT = 75;
const WINDOW_CRITICAL_PCT = 90;
const LONG_WINDOW_HOURS = 36;
const DIR_SEGMENTS = 2;
const GIT_SEARCH_DEPTH = 6;
const BRANCH_MAX_LENGTH = 18;
const DETACHED_SHA_LENGTH = 7;
const EPOCH_MS_THRESHOLD = 1e12;

export const PALETTES: Record<string, Palette> = {
  mahogany: {
    label: "Mahogany",
    accent: "#c4a050", accentInk: "#181210", ink: "#181210",
    text: "#ece4d8", muted: "#8a847c",
    zones: ["#6a7c5d", "#c4a050", "#d4a574", "#9d4451"],
  },
  catppuccin: {
    label: "Catppuccin Mocha",
    accent: "#89b4fa", accentInk: "#11111b", ink: "#11111b",
    text: "#cdd6f4", muted: "#7f849c",
    zones: ["#a6e3a1", "#f9e2af", "#fab387", "#f38ba8"],
  },
  dracula: {
    label: "Dracula",
    accent: "#bd93f9", accentInk: "#282a36", ink: "#282a36",
    text: "#f8f8f2", muted: "#6272a4",
    zones: ["#50fa7b", "#f1fa8c", "#ffb86c", "#ff5555"],
  },
  tokyonight: {
    label: "Tokyo Night",
    accent: "#7aa2f7", accentInk: "#16161e", ink: "#16161e",
    text: "#c0caf5", muted: "#545c7e",
    zones: ["#9ece6a", "#e0af68", "#ff9e64", "#f7768e"],
  },
  gruvbox: {
    label: "Gruvbox dark",
    accent: "#83a598", accentInk: "#282828", ink: "#282828",
    text: "#ebdbb2", muted: "#928374",
    zones: ["#b8bb26", "#fabd2f", "#fe8019", "#fb4934"],
  },
};

export const SEPARATORS: Record<string, Separator> = {
  slant: { open: "", close: "", thin: "" },
  slantBack: { open: "", close: "", thin: "" },
  arrow: { open: "", close: "", thin: "" },
};
const BRANCH_GLYPH = "";
const BOLD = 1;
const DIM = 2;
const DEFAULT_BG = 49;
const RESET = "\x1b[0m";
const CUBE_STEPS = [0, 95, 135, 175, 215, 255];
const CUBE_BASE = 16;
const GREY_BASE = 232;
const GREY_START = 8;
const GREY_STEP = 10;
const GREY_LAST = 23;

type Palette = { label: string; accent: string; accentInk: string; ink: string; text: string; muted: string; zones: string[] };
type Separator = { open: string; close: string; thin: string };
type Run = { text: string; color: string | null; mods: number[] };
type Segment = { fill: string | null; color: string; runs: Run[] };
export type Window = { usedPercent: number; seconds?: number; resetsAt?: number };
export type Status = { dir?: string; branch?: string; model?: string; effort?: string; tokens: number; percent: number; windows: Window[] };

const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

const nearest256 = (hex: string) => {
  const [r, g, b] = rgb(hex);
  const grey = Math.max(0, Math.min(GREY_LAST, Math.round(((r + g + b) / 3 - GREY_START) / GREY_STEP)));
  const greyValue = GREY_START + grey * GREY_STEP;
  const greyDist = (r - greyValue) ** 2 + (g - greyValue) ** 2 + (b - greyValue) ** 2;
  const idx = (c: number) => CUBE_STEPS.reduce((best, v, i) => (Math.abs(v - c) < Math.abs(CUBE_STEPS[best] - c) ? i : best), 0);
  const [ri, gi, bi] = [idx(r), idx(g), idx(b)];
  const cubeDist = (r - CUBE_STEPS[ri]) ** 2 + (g - CUBE_STEPS[gi]) ** 2 + (b - CUBE_STEPS[bi]) ** 2;
  return cubeDist <= greyDist ? CUBE_BASE + 36 * ri + 6 * gi + bi : GREY_BASE + grey;
};

const TRUECOLOR = process.env.STATUSLINE_COLOR_MODE !== "256";
const fg = (hex: string) => (TRUECOLOR ? [38, 2, ...rgb(hex)] : [38, 5, nearest256(hex)]);
const bg = (hex: string | null) => (hex ? (TRUECOLOR ? [48, 2, ...rgb(hex)] : [48, 5, nearest256(hex)]) : [DEFAULT_BG]);
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

const fmtReset = (epoch: number, long: boolean) => {
  const t = new Date(epoch > EPOCH_MS_THRESHOLD ? epoch : epoch * 1000);
  return long
    ? `${String(t.getDate()).padStart(2, "0")}.${String(t.getMonth() + 1).padStart(2, "0")}`
    : `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
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

const windowLabel = (seconds: number | undefined) => {
  if (!seconds || seconds <= 0) return "lim";
  const h = seconds / 3600;
  return h <= LONG_WINDOW_HOURS ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
};

const segments = (s: Status, p: Palette) => {
  const out: Segment[] = [];

  if (s.dir) out.push(segment(p.accent, p.accentInk, [run(` ${fmtDir(s.dir)} `)]));

  const branch = s.branch ?? (s.dir ? gitBranch(s.dir) : "");
  if (branch) {
    const label = branch.length > BRANCH_MAX_LENGTH ? `${branch.slice(0, BRANCH_MAX_LENGTH - 1)}…` : branch;
    out.push(segment(null, p.text, [run(` ${BRANCH_GLYPH} ${label} `)]));
  }

  if (s.model) {
    const runs = [run(` ${s.model} `)];
    if (s.effort) runs.push(run(`${s.effort} `, p.muted));
    out.push(segment(null, p.text, runs));
  }

  const pct = Math.floor(s.percent);
  const zone = p.zones[Math.max(tokenLevel(s.tokens), percentLevel(pct))];
  out.push(segment(zone, p.ink, [run(` ${fmtTokens(s.tokens)} `, null, BOLD)]));
  out.push(segment(null, zone, [run(` ${pct}% `)]));

  for (const w of s.windows) {
    const used = Math.round(w.usedPercent);
    const long = !!w.seconds && w.seconds > LONG_WINDOW_HOURS * 3600;
    const runs = [run(` ${windowLabel(w.seconds)} ${used}% `, p.zones[percentLevel(used)])];
    if (w.resetsAt != null) runs.push(run(`↻${fmtReset(w.resetsAt, long)} `, p.text, DIM));
    out.push(segment(null, p.text, runs));
  }

  return out;
};

export function statusline(s: Status, options: { palette?: string; separator?: string; width?: number } = {}): string {
  const p = PALETTES[options.palette ?? process.env.STATUSLINE_PALETTE ?? ""] ?? PALETTES.mahogany;
  const sep = SEPARATORS[options.separator ?? process.env.STATUSLINE_SEPARATOR ?? ""] ?? SEPARATORS.slant;
  const parts = segments(s, p);
  let line = renderLine(parts, p, sep);
  while (options.width !== undefined && visibleWidth(line) > options.width && parts.length > 1) {
    parts.splice(1, 1);
    line = renderLine(parts, p, sep);
  }
  return line;
}
