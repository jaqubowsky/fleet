#!/usr/bin/env node

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

const PALETTES = {
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

const SEPARATORS = {
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

const rgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const nearest256 = (hex) => {
  const [r, g, b] = rgb(hex);
  const grey = Math.max(0, Math.min(GREY_LAST, Math.round(((r + g + b) / 3 - GREY_START) / GREY_STEP)));
  const greyValue = GREY_START + grey * GREY_STEP;
  const greyDist = (r - greyValue) ** 2 + (g - greyValue) ** 2 + (b - greyValue) ** 2;
  const idx = (c) =>
    CUBE_STEPS.reduce((best, v, i) => (Math.abs(v - c) < Math.abs(CUBE_STEPS[best] - c) ? i : best), 0);
  const [ri, gi, bi] = [idx(r), idx(g), idx(b)];
  const cubeDist = (r - CUBE_STEPS[ri]) ** 2 + (g - CUBE_STEPS[gi]) ** 2 + (b - CUBE_STEPS[bi]) ** 2;
  return cubeDist <= greyDist ? CUBE_BASE + 36 * ri + 6 * gi + bi : GREY_BASE + grey;
};

const TRUECOLOR = process.env.STATUSLINE_COLOR_MODE !== "256";
const fg = (hex) => (TRUECOLOR ? [38, 2, ...rgb(hex)] : [38, 5, nearest256(hex)]);
const bg = (hex) => (hex ? (TRUECOLOR ? [48, 2, ...rgb(hex)] : [48, 5, nearest256(hex)]) : [DEFAULT_BG]);
const sgr = (...codes) => `\x1b[${codes.join(";")}m`;

const tokenLevel = (t) =>
  t >= DUMB_ZONE_TOKENS ? 3 : t >= NEAR_DUMB_TOKENS ? 2 : t >= WATCH_TOKENS ? 1 : 0;
const percentLevel = (p) =>
  p >= WINDOW_CRITICAL_PCT ? 3 : p >= WINDOW_HIGH_PCT ? 2 : p >= WINDOW_HALF_PCT ? 1 : 0;

const run = (text, color, ...mods) => ({ text, color, mods });
const segment = (fill, color, runs) => ({ fill, color, runs });

const renderLine = (segments, p, sep) => {
  const parts = [];
  segments.forEach((seg, i) => {
    const prev = segments[i - 1];
    if (seg.fill && !prev?.fill) parts.push(sgr(DEFAULT_BG, ...fg(seg.fill)) + sep.open);
    parts.push(
      seg.runs
        .map((r) => sgr(...bg(seg.fill), ...fg(r.color ?? seg.color), ...r.mods) + r.text)
        .join(""),
    );
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

const fmtTokens = (n) =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n);

const fmtClock = (epochSeconds) => {
  const t = new Date(epochSeconds * 1000);
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
};

const fmtDir = (path) => {
  const home = process.env.HOME ?? "";
  const inHome = home && (path === home || path.startsWith(home + "/"));
  const parts = (inHome ? path.slice(home.length) : path).split("/").filter(Boolean);
  if (!parts.length) return "~";
  if (parts.length > DIR_SEGMENTS) return `…/${parts.slice(-DIR_SEGMENTS).join("/")}`;
  return (inHome ? "~/" : "/") + parts.join("/");
};

const gitBranch = (startDir) => {
  if (!startDir) return "";
  let dir = startDir;
  for (let depth = 0; depth < GIT_SEARCH_DEPTH; depth++) {
    try {
      const marker = `${dir}/.git`;
      const stat = fs.statSync(marker);
      let gitDir = marker;
      if (!stat.isDirectory()) {
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

const buildSegments = (d, p) => {
  const segments = [];

  const dir = d.workspace?.current_dir ?? d.cwd;
  if (dir) segments.push(segment(p.accent, p.accentInk, [run(` ${fmtDir(dir)} `)]));

  const branch = d.worktree?.branch ?? gitBranch(dir);
  if (branch) {
    const label =
      branch.length > BRANCH_MAX_LENGTH ? `${branch.slice(0, BRANCH_MAX_LENGTH - 1)}…` : branch;
    segments.push(segment(null, p.text, [run(` ${BRANCH_GLYPH} ${label} `)]));
  }

  const model = d.model?.display_name;
  if (model) {
    const runs = [run(` ${model} `)];
    if (d.effort?.level) runs.push(run(`${d.effort.level} `, p.muted));
    segments.push(segment(null, p.text, runs));
  }

  const tokens =
    (d.context_window?.total_input_tokens ?? 0) + (d.context_window?.total_output_tokens ?? 0);
  const pct = Math.floor(d.context_window?.used_percentage ?? 0);
  const zone = p.zones[Math.max(tokenLevel(tokens), percentLevel(pct))];
  segments.push(segment(zone, p.ink, [run(` ${fmtTokens(tokens)} `, null, BOLD)]));
  segments.push(segment(null, zone, [run(` ${pct}% `)]));

  const fiveH = d.rate_limits?.five_hour;
  if (fiveH?.used_percentage != null) {
    const used = Math.round(fiveH.used_percentage);
    const runs = [run(` 5h ${used}% `, p.zones[percentLevel(used)])];
    if (fiveH.resets_at != null) runs.push(run(`↻${fmtClock(fiveH.resets_at)} `, p.muted, DIM));
    segments.push(segment(null, p.text, runs));
  }

  const week = d.rate_limits?.seven_day?.used_percentage;
  if (week != null) {
    const used = Math.round(week);
    segments.push(segment(null, p.zones[percentLevel(used)], [run(` 7d ${used}% `)]));
  }

  return segments;
};

const statusline = (d, paletteName, separatorName) => {
  const p = PALETTES[paletteName] ?? PALETTES.catppuccin;
  return renderLine(buildSegments(d, p), p, SEPARATORS[separatorName] ?? SEPARATORS.slant);
};

const DEMO_PAYLOAD = (tok, fiveH) => ({
  workspace: { current_dir: `${process.env.HOME}/my-knowledge-base` },
  model: { display_name: "Opus 5 (1M context)" },
  effort: { level: "xhigh" },
  context_window: {
    total_input_tokens: tok - 2000,
    total_output_tokens: 2000,
    context_window_size: 1_000_000,
    used_percentage: (tok / 1_000_000) * 100,
  },
  rate_limits: {
    five_hour: { used_percentage: fiveH, resets_at: Math.floor(Date.now() / 1000) + 8040 },
    seven_day: { used_percentage: 6 },
  },
});

const SCENARIOS = [
  ["świeża", 82_000, 15],
  ["watch 150k", 168_000, 62],
  ["blisko 200k", 220_000, 81],
  ["dumb 250k", 270_000, 94],
];

if (process.argv[2] === "--demo") {
  const sep = process.env.STATUSLINE_SEPARATOR ?? "slant";
  for (const [name, p] of Object.entries(PALETTES)) {
    console.log(`\n  \x1b[1m${name}\x1b[0m  \x1b[2m— ${p.label}\x1b[0m`);
    for (const [label, tok, fiveH] of SCENARIOS) {
      console.log(`  \x1b[2m${label.padEnd(7)}\x1b[0m${statusline(DEMO_PAYLOAD(tok, fiveH), name, sep)}`);
    }
  }
  console.log(`\n  \x1b[1mseparatory\x1b[0m`);
  for (const name of Object.keys(SEPARATORS)) {
    console.log(`  \x1b[2m${name.padEnd(10)}\x1b[0m${statusline(DEMO_PAYLOAD(270_000, 81), process.env.STATUSLINE_PALETTE, name)}`);
  }
  console.log();
} else {
  let input = "";
  process.stdin.on("data", (c) => (input += c));
  process.stdin.on("end", () => {
    let d = {};
    try {
      d = JSON.parse(input);
    } catch {}
    console.log(statusline(d, process.env.STATUSLINE_PALETTE, process.env.STATUSLINE_SEPARATOR));
  });
}
