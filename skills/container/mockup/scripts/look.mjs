import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const SIZES = {
  phone: { w: 390, h: 844, label: "phone" },
  tablet: { w: 834, h: 1194, label: "tablet" },
  desktop: { w: 1440, h: 900, label: "desktop" }
};
const SETTLE_MS = 600;
const STEP_MS = 400;

const root = resolve("mockup");
const boardFile = join(root, "board.js");
const checker = readFileSync(new URL("check-layout.js", import.meta.url), "utf8");
const only = process.argv.slice(2);

function fail(message) {
  console.error(`look: ${message}`);
  process.exit(2);
}

function readBoard() {
  if (!existsSync(boardFile)) fail(`no ${boardFile}; run from the task directory after Build`);
  const entries = [];
  try {
    vm.runInNewContext(readFileSync(boardFile, "utf8"), { board: entry => entries.push(entry) }, { filename: boardFile });
  } catch (error) {
    fail(`mockup/board.js does not run, so the board shows nothing: ${error.message}`);
  }
  return entries;
}

function playwright() {
  const global = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  const require = createRequire(import.meta.url);
  for (const path of [join(global, "@playwright/cli/node_modules/playwright-core"), join(global, "playwright-core"), "playwright-core"]) {
    try { return require(path); } catch {}
  }
  fail("playwright-core not found next to playwright-cli");
}

const sizeOf = s => typeof s === "string" ? SIZES[s] : s && { label: `${s.w}x${s.h}`, ...s };

async function act(page, step) {
  const [verb, arg] = Object.entries(step)[0];
  if (verb === "click") await page.click(arg);
  else if (verb === "hover") await page.hover(arg);
  else if (verb === "fill") await page.fill(arg[0], arg[1]);
  else if (verb === "press") await page.keyboard.press(arg);
  else if (verb === "wait") await page.waitForTimeout(arg);
  else if (verb === "eval") await page.evaluate(arg);
  else if (verb === "drag") {
    const box = await page.locator(arg[0]).first().boundingBox();
    if (!box) throw new Error(`${arg[0]} is not visible`);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + arg[1], y + arg[2], { steps: 12 });
    await page.mouse.up();
  } else throw new Error(`unknown step ${verb}; use click, hover, fill, press, drag, wait or eval`);
}

async function shoot(browser, url, size, out, steps = []) {
  const page = await browser.newPage({ viewport: { width: size.w, height: size.h } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", msg => msg.type() === "error" && errors.push(msg.text()));
  const findings = [];
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(SETTLE_MS);
    for (const step of steps) {
      await act(page, step);
      await page.waitForTimeout(STEP_MS);
    }
    const result = await page.evaluate(`(${checker})()`);
    findings.push(...result.findings);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height > size.h + 1) findings.push({ kind: "taller", where: "document", detail: `scrollHeight ${height} > frame ${size.h}; the frame shows the top ${size.h}px and scrolls` });
    await page.screenshot({ path: out });
  } catch (error) {
    findings.push({ kind: "step-failed", where: url.split("/").slice(-2).join("/"), detail: error.message.split("\n")[0] });
  }
  for (const message of errors) findings.push({ kind: "js-error", where: "console", detail: message.slice(0, 160) });
  await page.close();
  return findings;
}

const board = readBoard();
const problems = [];
for (const entry of board) {
  if (!entry.slug) problems.push("a board() call has no slug");
  for (const frame of entry.frames || []) {
    if (!existsSync(join(root, entry.slug, frame.file))) problems.push(`${entry.slug}: ${frame.file} does not exist`);
    if (frame.size && !sizeOf(frame.size)) problems.push(`${entry.slug}/${frame.file}: size ${JSON.stringify(frame.size)}; use phone, tablet, desktop or { w, h }`);
  }
  if (!(entry.frames || []).length) problems.push(`${entry.slug}: no frames`);
}
if (problems.length) fail(problems.join("\n      "));

const { chromium } = playwright();
const browser = await chromium.launch();
let total = 0;
for (const entry of board.filter(e => !only.length || only.includes(e.slug))) {
  const shots = join(root, entry.slug, "shots");
  mkdirSync(shots, { recursive: true });
  for (const frame of entry.frames) {
    const size = sizeOf(frame.size || "desktop");
    const url = pathToFileURL(join(root, entry.slug, frame.file)).href;
    const stem = basename(frame.file, ".html");
    const runs = [{ name: "", steps: [] }, ...(frame.play || [])];
    for (const run of runs) {
      const out = join(shots, `${stem}-${size.label}${run.name ? `-${run.name}` : ""}.png`);
      const findings = await shoot(browser, url, size, out, run.steps);
      const counted = findings.filter(f => !["taller", "low-contrast"].includes(f.kind));
      total += counted.length;
      const label = run.name ? ` after ${run.name}` : "";
      console.log(`== ${entry.slug}/${frame.file} ${size.label}${label}: count ${counted.length}  ${out}`);
      for (const f of findings) console.log(`   ${f.kind} ${f.where} ${f.detail}`);
    }
  }
}

const boardShot = join(root, "board.png");
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(pathToFileURL(join(root, "index.html")).href);
await page.waitForTimeout(SETTLE_MS * 2);
const shown = await page.evaluate(() => document.querySelectorAll(".frame").length);
await page.screenshot({ path: boardShot });
await browser.close();
const declared = board.reduce((n, e) => n + e.frames.length, 0);
console.log(`== board: ${shown} of ${declared} frames shown  ${boardShot}`);
if (shown !== declared) total += 1;
console.log(`count: ${total}`);
process.exit(total ? 1 : 0);
