import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const skill = resolve(import.meta.dirname, "../../skills/container/mockup");

const page = (body: string) =>
	`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{margin:8px;font:16px sans-serif;color:#111;background:#fff}</style></head><body>${body}</body></html>`;

const pages = {
	"select.html": page(
		'<div class="control" style="width:240px;height:48px;border:1px solid #444;display:flex;align-items:center">Choose a document<input id="react-select-2-input" style="opacity:0;width:1px;position:relative;left:-280px;border:0;padding:0" readonly></div>',
	),
	"offscreen.html": page('<button id="save" style="position:relative;left:-200px;height:48px">Save</button>'),
	"faint.html": page('<button id="faint" style="color:#ddd;background:#fff;border:1px solid #444;height:48px">Archive</button>'),
};

function look() {
	const dir = mkdtempSync(join(tmpdir(), "look-"));
	const mockup = join(dir, "mockup");
	mkdirSync(join(mockup, "fixture"), { recursive: true });
	cpSync(join(skill, "board"), mockup, { recursive: true });
	for (const [file, html] of Object.entries(pages)) writeFileSync(join(mockup, "fixture", file), html);
	const frames = Object.keys(pages).map((file) => ({ id: file, file, title: file, size: { w: 1440, h: 300 } }));
	writeFileSync(join(mockup, "board.js"), `board(${JSON.stringify({ slug: "fixture", title: "fixture", frames })});\n`);

	const run = spawnSync("node", [join(skill, "scripts/look.mjs"), "fixture"], { cwd: dir, encoding: "utf8", timeout: 120000 });

	rmSync(dir, { recursive: true, force: true });
	return { status: run.status, output: run.stdout + run.stderr };
}

const { status, output } = look();

test("look keeps a transparent input inside a visible control out of the layout findings", () => {
	assert.doesNotMatch(output, /off-viewport [^\n]*react-select-2-input/, output);
});

test("look still reports a visible control pushed off the viewport", () => {
	assert.match(output, /off-viewport button#save/, output);
});

test("look reports layout, accessibility and execution as separate totals", () => {
	assert.match(output, /low-contrast button#faint/, output);
	assert.match(output, /^layout: [1-9]\d*$/m, output);
	assert.match(output, /^accessibility: [1-9]\d*$/m, output);
	assert.match(output, /^execution: 0$/m, output);
	assert.doesNotMatch(output, /^count: /m, output);
	assert.equal(status, 1);
});

test("the checker test drives the playwright-cli version the image installs", () => {
	const image = readFileSync(resolve(import.meta.dirname, "../../sbx/container/toolchain.Dockerfile"), "utf8").match(/^ARG PLAYWRIGHT_CLI_VERSION=(.+)$/m)?.[1];
	const pinned = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8")).devDependencies["@playwright/cli"];

	assert.equal(pinned, image);
});
