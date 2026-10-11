import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeIo } from "./fake-io.ts";
import { lastMessage } from "./sessions.ts";

const DIR = "/task/logs/sessions";

function claude(content: { type: string; text?: string }[], extra: Record<string, unknown> = {}) {
	return JSON.stringify({ type: "assistant", message: { role: "assistant", content }, ...extra });
}

function pi(content: { type: string; text?: string }[], stop: Record<string, string> = { stopReason: "stop" }) {
	return JSON.stringify({ type: "message", message: { role: "assistant", content, ...stop } });
}

function sessions(files: Record<string, string>, mtimes: Record<string, number> = {}) {
	const io = fakeIo({
		[`list ${DIR}`]: [...Object.keys(files), "projects"],
		...Object.fromEntries(
			Object.entries(mtimes).map(([file, at]) => [`stat ${DIR}/${file}`, { size: 1, mtime: new Date(at), dir: false }]),
		),
	});
	for (const [file, body] of Object.entries(files)) io.files[`${DIR}/${file}`] = body;
	return io;
}

test("a claude turn's last text is the agent's last message", () => {
	const io = sessions({
		"s.jsonl": [
			claude([{ type: "text", text: "Reading the ticket." }]),
			JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result" }] } }),
			claude([{ type: "thinking" }]),
			claude([{ type: "text", text: "Added the column.\n\nOpen questions:\n- Hide it on empty lists?" }]),
			JSON.stringify({ type: "system", subtype: "turn_duration" }),
			"",
		].join("\n"),
	});

	const message = lastMessage(DIR, io);

	assert.equal(message, "Added the column.\n\nOpen questions:\n- Hide it on empty lists?");
});

test("a turn still on a tool call keeps the last thing the agent said", () => {
	const io = sessions({
		"s.jsonl": [
			claude([{ type: "text", text: "Running the web suite." }]),
			claude([{ type: "tool_use" }]),
			'{"type":"user","message":{"role":"us',
		].join("\n"),
	});

	const message = lastMessage(DIR, io);

	assert.equal(message, "Running the web suite.");
});

test("an account limit the claude agent stopped on is its last message", () => {
	const io = sessions({
		"s.jsonl": claude([{ type: "text", text: "You've hit your weekly limit · resets Oct 2, 8am (UTC)" }], {
			isApiErrorMessage: true,
		}),
	});

	const message = lastMessage(DIR, io);

	assert.equal(message, "You've hit your weekly limit · resets Oct 2, 8am (UTC)");
});

test("a pi turn that failed names its stop reason after the last thing it said", () => {
	const io = sessions({
		"s.jsonl": [
			pi([{ type: "text", text: "Done." }]),
			pi([{ type: "text", text: "Checking the build" }], { stopReason: "aborted", errorMessage: "Interrupted by user" }),
			pi([], { stopReason: "error", errorMessage: "429 rate limit" }),
		].join("\n"),
	});

	const message = lastMessage(DIR, io);

	assert.equal(message, "Checking the build\n\nstopped on error: 429 rate limit");
});

test("the newest session holds the last message", () => {
	const io = sessions(
		{
			"a.jsonl": pi([{ type: "text", text: "after the resume" }]),
			"b.jsonl": pi([{ type: "text", text: "before the resume" }]),
		},
		{ "a.jsonl": 2000, "b.jsonl": 1000 },
	);

	const message = lastMessage(DIR, io);

	assert.equal(message, "after the resume");
});

test("a container with no session yet has no last message", () => {
	const message = lastMessage(DIR, sessions({}));

	assert.equal(message, undefined);
});
