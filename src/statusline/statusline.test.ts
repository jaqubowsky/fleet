import assert from "node:assert/strict";
import { test } from "node:test";
import { statusline } from "./statusline.ts";

test("the status line draws in mahogany unless a palette is named", (t) => {
	const named = process.env.STATUSLINE_PALETTE;
	delete process.env.STATUSLINE_PALETTE;
	t.after(() => {
		if (named !== undefined) process.env.STATUSLINE_PALETTE = named;
	});

	const line = statusline({ dir: "/tmp", branch: "", tokens: 0, percent: 0, windows: [] });

	assert.match(line, /48;2;196;160;80;38;2;24;18;16m \/tmp /);
});
