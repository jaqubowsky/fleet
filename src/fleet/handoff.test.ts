import assert from "node:assert/strict";
import { test } from "node:test";
import { deathNote } from "../../extensions/handoff-on-error.ts";

const running = "status: implementing\nattention: none\nnow: 01-fix, red written\n\n## Log\n- analysis: a defect; analysis.md\n";

test("a session dying mid-work leaves status blocked with the error as attention", () => {
	const next = deathNote(running, "402 Payment Required: insufficient credits\nstack...");

	assert.equal(
		next,
		"status: blocked\nattention: the agent stopped on an error: 402 Payment Required: insufficient credits\nnow: 01-fix, red written\n\n## Log\n- analysis: a defect; analysis.md\n",
	);
});

test("a blocked task keeps the blocker it already names", () => {
	assert.equal(deathNote(running.replace("implementing", "blocked"), "boom"), undefined);
	assert.equal(deathNote(undefined, "boom"), undefined);
});

test("a status without an attention line gets one", () => {
	const next = deathNote("status: implementing\nnow: fix\n", "boom");

	assert.equal(next, "status: blocked\nattention: the agent stopped on an error: boom\nnow: fix\n");
});
