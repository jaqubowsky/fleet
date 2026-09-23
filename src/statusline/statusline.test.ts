import assert from "node:assert/strict";
import { test } from "node:test";
import { type Status, statusline } from "./statusline.ts";

const visible = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
const full: Status = {
	dir: "/tmp",
	branch: "main",
	model: "gpt-6-sol",
	effort: "xhigh",
	tokens: 125_000,
	percent: 12.5,
	windows: [{ usedPercent: 62, seconds: 5 * 3600 }, { usedPercent: 91, seconds: 7 * 86400 }],
};

test("the status line draws in mahogany unless a palette is named", (t) => {
	const named = process.env.STATUSLINE_PALETTE;
	delete process.env.STATUSLINE_PALETTE;
	t.after(() => {
		if (named !== undefined) process.env.STATUSLINE_PALETTE = named;
	});

	const line = statusline({ dir: "/tmp", branch: "", tokens: 0, percent: 0, windows: [] });

	assert.match(line, /38;2;196;160;80;1m\/tmp/);
});

test("the context bar fills toward the 250k handoff", () => {
	assert.match(visible(statusline(full)), /━━━━━─────  125k 12%/);
});

test("limits read as a label and a share", () => {
	assert.match(visible(statusline(full)), /5h 62%   7d 91%/);
});

test("a narrow line gives up the branch, the model and the limits before the folder and the context", () => {
	const line = visible(statusline(full, { width: 32 }));

	assert.match(line, /\/tmp/);
	assert.match(line, /125k 12%/);
	assert.doesNotMatch(line, /main|gpt-6-sol|5h|7d/);
});
