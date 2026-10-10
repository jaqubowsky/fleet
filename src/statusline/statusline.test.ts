import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { COMPACT_AT, type Status, statusline, watching } from "./statusline.ts";

const visible = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
const full: Status = {
	dir: "/tmp",
	branch: "main",
	model: "gpt-6-sol",
	effort: "xhigh",
	tokens: 125_000,
	windows: [{ usedPercent: 62, seconds: 5 * 3600 }, { usedPercent: 91, seconds: 7 * 86400 }],
};

test("the status line speaks the terminal's own palette, so it follows the terminal theme", () => {
	const line = statusline({ dir: "/tmp", branch: "", tokens: 0, windows: [] });

	assert.match(line, /\x1b\[33;1m\/tmp/);
	assert.doesNotMatch(line, /38;2;/);
});

test("the context bar fills toward the 400k compaction point and shows the tokens against it", () => {
	const line = statusline({ ...full, tokens: 182_000 });

	assert.match(visible(line), /━━━━━─────  182k\/400k/);
	assert.match(line, /\x1b\[32m━━━━━/);
});

test("the context bar turns yellow at half and red at three quarters of the compaction point", () => {
	assert.match(statusline({ ...full, tokens: 300_000 }), /\x1b\[31m━━━━━━━━/);
	assert.match(statusline({ ...full, tokens: 200_000 }), /\x1b\[33m━━━━━/);
});

test("the statusline names no dumb zone and reads the compaction point from its one source", () => {
	const source = JSON.parse(readFileSync(new URL("../compaction.json", import.meta.url), "utf8"));

	assert.equal(COMPACT_AT, source.tokens);
	for (const file of ["src/statusline/statusline.ts", "claude/statusline.mjs", "extensions/statusline.ts"])
		assert.doesNotMatch(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), /dumb/i, file);
});

test("limits read as a label and a share", () => {
	assert.match(visible(statusline(full)), /5h 62%   7d 91%/);
});

test("a narrow line gives up the branch, the model and the limits before the folder and the context", () => {
	const line = visible(statusline(full, { width: 32 }));

	assert.match(line, /\/tmp/);
	assert.match(line, /125k\/400k/);
	assert.doesNotMatch(line, /main|gpt-6-sol|5h|7d/);
});

test("remote control shows as a quiet marker at the end of the line", () => {
	const line = statusline({ ...full, remote: "⌁ remote" });

	assert.match(line, /\x1b\[90m⌁ remote\x1b\[0m$/);
});

test("the marker takes the accent while phones watch", () => {
	const line = statusline({ ...full, remote: "⌁ remote 2" });

	assert.match(line, /\x1b\[33m⌁ remote 2\x1b\[0m$/);
});

test("a narrow line gives up the marker before anything else", () => {
	const width = visible(statusline(full)).length;

	assert.equal(statusline({ ...full, remote: "⌁ remote 2" }, { width }), statusline(full));
});

test("the watched containers get a line of their own, coloured like the status line", () => {
	const line = watching("claude-a working · pi-b blocked · pi-c done · pi-d idle · pi-e unknown");

	assert.equal(visible(line), " ◉ watching  claude-a working · pi-b blocked · pi-c done · pi-d idle · pi-e unknown");
	assert.match(line, /\x1b\[35mwatching/);
	assert.match(line, /\x1b\[39mclaude-a /);
	assert.match(line, /\x1b\[33mworking/);
	assert.match(line, /\x1b\[31mblocked/);
	assert.match(line, /\x1b\[32mdone/);
	assert.match(line, /\x1b\[32midle/);
	assert.match(line, /\x1b\[35munknown/);
});
