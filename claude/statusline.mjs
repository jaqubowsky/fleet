#!/usr/bin/env node

import { PALETTES, SEPARATORS, statusline } from "../src/statusline/statusline.ts";

const FIVE_HOURS = 5 * 3600;
const SEVEN_DAYS = 7 * 86400;

const status = (d) => {
  const limits = d.rate_limits ?? {};
  const windows = [];
  if (limits.five_hour?.used_percentage != null)
    windows.push({ usedPercent: limits.five_hour.used_percentage, seconds: FIVE_HOURS, resetsAt: limits.five_hour.resets_at ?? undefined });
  if (limits.seven_day?.used_percentage != null) windows.push({ usedPercent: limits.seven_day.used_percentage, seconds: SEVEN_DAYS });
  return {
    dir: d.workspace?.current_dir ?? d.cwd,
    branch: d.worktree?.branch,
    model: d.model?.display_name,
    effort: d.effort?.level,
    tokens: (d.context_window?.total_input_tokens ?? 0) + (d.context_window?.total_output_tokens ?? 0),
    percent: d.context_window?.used_percentage ?? 0,
    windows,
  };
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
  const separator = process.env.STATUSLINE_SEPARATOR ?? "slant";
  for (const [name, p] of Object.entries(PALETTES)) {
    console.log(`\n  \x1b[1m${name}\x1b[0m  \x1b[2m— ${p.label}\x1b[0m`);
    for (const [label, tok, fiveH] of SCENARIOS) {
      console.log(`  \x1b[2m${label.padEnd(7)}\x1b[0m${statusline(status(DEMO_PAYLOAD(tok, fiveH)), { palette: name, separator })}`);
    }
  }
  console.log(`\n  \x1b[1mseparatory\x1b[0m`);
  for (const name of Object.keys(SEPARATORS)) {
    console.log(`  \x1b[2m${name.padEnd(10)}\x1b[0m${statusline(status(DEMO_PAYLOAD(270_000, 81)), { separator: name })}`);
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
    console.log(statusline(status(d)));
  });
}
