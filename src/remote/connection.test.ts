import assert from "node:assert/strict";
import test from "node:test";
import { deliberate } from "../../extensions/pi-remote/connection.js";

const aborted = () => {
	const controller = new AbortController();
	controller.abort();
	return controller.signal.reason;
};

test("our own resync is not a failure to report", () => {
	assert.equal(deliberate(aborted(), true), true);
});

test("a dropped stream is a failure to report", () => {
	assert.equal(deliberate(new Error("Disconnected. Reconnecting..."), false), false);
	assert.equal(deliberate(new Error("Link expired. Scan /remote link again."), true), false);
	assert.equal(deliberate(aborted(), false), false);
});
