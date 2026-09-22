import assert from "node:assert/strict";
import test from "node:test";
import {
	deliberate,
	terminal,
} from "../../extensions/pi-remote/connection.js";

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

test("only the wakeup's own abort is deliberate, not a failed command's", () => {
	assert.equal(deliberate(aborted(), false), false);
	assert.equal(deliberate(aborted(), true), true);
});

test("a refused link is terminal, whatever refused it", () => {
	assert.equal(terminal("Link expired. Scan /remote link again."), true);
	assert.equal(terminal("Too many phones are watching this link (429)."), true);
	assert.equal(terminal("Disconnected. Reconnecting..."), false);
});
