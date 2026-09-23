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
const BAR_CELLS = 10;
const GAP = "   ";

const BRANCH_GLYPH = "";
const RESET = "\x1b[0m";
const FOLDER = [33, 1];
const BRANCH = [34];
const MODEL = [39];
const EFFORT = [35];
const MUTED = [90];
const ZONES = [[32], [33], [31], [91, 1]];

type Run = { text: string; codes: number[] };
type Group = { rank: number; runs: Run[] };
export type Window = { usedPercent: number; seconds?: number; resetsAt?: number };
export type Status = { dir?: string; branch?: string; model?: string; effort?: string; tokens: number; percent: number; windows: Window[] };

const tokenLevel = (t: number) => (t >= DUMB_ZONE_TOKENS ? 3 : t >= NEAR_DUMB_TOKENS ? 2 : t >= WATCH_TOKENS ? 1 : 0);
const percentLevel = (p: number) => (p >= WINDOW_CRITICAL_PCT ? 3 : p >= WINDOW_HIGH_PCT ? 2 : p >= WINDOW_HALF_PCT ? 1 : 0);

const run = (text: string, codes: number[]): Run => ({ text, codes });

const draw = (groups: Group[]) => ` ${groups.map((g) => g.runs.map((r) => `\x1b[${r.codes.join(";")}m${r.text}${RESET}`).join("")).join(GAP)}`;

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

const bar = (tokens: number, zone: number[]) => {
  const filled = Math.min(BAR_CELLS, Math.round((tokens / DUMB_ZONE_TOKENS) * BAR_CELLS));
  return [run("━".repeat(filled), zone), run("─".repeat(BAR_CELLS - filled), MUTED)];
};

const groups = (s: Status): Group[] => {
  const out: Group[] = [];

  if (s.dir) out.push({ rank: 4, runs: [run(fmtDir(s.dir), FOLDER)] });

  const branch = s.branch ?? (s.dir ? gitBranch(s.dir) : "");
  if (branch) {
    const label = branch.length > BRANCH_MAX_LENGTH ? `${branch.slice(0, BRANCH_MAX_LENGTH - 1)}…` : branch;
    out.push({ rank: 1, runs: [run(`${BRANCH_GLYPH} ${label}`, BRANCH)] });
  }

  if (s.model) out.push({ rank: 2, runs: [run(s.model, MODEL), ...(s.effort ? [run(` ${s.effort}`, EFFORT)] : [])] });

  const pct = Math.floor(s.percent);
  const zone = ZONES[Math.max(tokenLevel(s.tokens), percentLevel(pct))];
  out.push({ rank: 5, runs: [...bar(s.tokens, zone), run(`  ${fmtTokens(s.tokens)}`, [...zone, 1]), run(` ${pct}%`, MUTED)] });

  for (const w of s.windows) {
    const used = Math.round(w.usedPercent);
    const long = !!w.seconds && w.seconds > LONG_WINDOW_HOURS * 3600;
    const runs = [run(`${windowLabel(w.seconds)} `, MUTED), run(`${used}%`, ZONES[percentLevel(used)])];
    if (w.resetsAt != null) runs.push(run(` ↻${fmtReset(w.resetsAt, long)}`, MUTED));
    out.push({ rank: 3, runs });
  }

  return out;
};

export function statusline(s: Status, options: { width?: number } = {}): string {
  const shown = groups(s);
  let line = draw(shown);
  while (options.width !== undefined && visibleWidth(line) > options.width && shown.length > 1) {
    const ranks = shown.map((g) => g.rank);
    shown.splice(ranks.lastIndexOf(Math.min(...ranks)), 1);
    line = draw(shown);
  }
  return line;
}
