import assert from "node:assert/strict";
import { test } from "node:test";
import { deathNote } from "../../agent/extensions/handoff-on-error.ts";

const running = "status: implementing\nattention: none\ncommit: none\npr: none\n\n## Plan\n- [x] read\n- [ ] fix\n";

test("a session dying mid-work leaves status blocked with the error as attention", () => {
	const next = deathNote(running, "402 Payment Required: insufficient credits\nstack...");

	assert.equal(
		next,
		"status: blocked\nattention: pi stopped on an error before done: 402 Payment Required: insufficient credits\ncommit: none\npr: none\n\n## Plan\n- [x] read\n- [ ] fix\n",
	);
});

test("a task already done or blocked keeps its status", () => {
	assert.equal(deathNote(running.replace("implementing", "done"), "boom"), undefined);
	assert.equal(deathNote(running.replace("implementing", "blocked"), "boom"), undefined);
	assert.equal(deathNote(undefined, "boom"), undefined);
});

test("a status without an attention line gets one", () => {
	const next = deathNote("status: implementing\ncommit: none\n", "boom");

	assert.equal(next, "status: blocked\nattention: pi stopped on an error before done: boom\ncommit: none\n");
});
