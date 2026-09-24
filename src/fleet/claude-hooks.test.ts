import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test, type TestContext } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearedNote, contextAdvice, contextTokens, handoffNote, tail } from "../../claude/hooks/container.ts";

const turn = (input: number, cached: number) => JSON.stringify({ type: "assistant", message: { usage: { input_tokens: input, cache_read_input_tokens: cached, cache_creation_input_tokens: 0 } } });
const status = "status: implementing\nattention: none\n\n## Summary\nx\n";

test("the context is what the last answer carried, not the sum of the session", () => {
	const transcript = [turn(100, 1000), JSON.stringify({ type: "user" }), turn(200, 260000), "not json"].join("\n");

	assert.equal(contextTokens(transcript), 260200);
	assert.equal(contextTokens(""), 0);
});

test("the context is read from the end of a transcript larger than the tail", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "claude-hooks-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const file = join(dir, "session.jsonl");
	writeFileSync(file, [turn(1, 1), JSON.stringify({ type: "user", pad: "x".repeat(4096) }), turn(300, 250000)].join("\n"));

	const window = tail(file, 2048);

	assert.equal(Buffer.byteLength(window), 2048);
	assert.equal(contextTokens(window), 250300);
});

test("past the threshold the agent hears that ending the session is worth it", () => {
	assert.equal(contextAdvice(249_999, 250_000), undefined);
	assert.match(contextAdvice(250_000, 250_000) ?? "", /passed 250000 tokens.*End this session.*end your turn, and the host starts a fresh session\.$/);
});

test("a context past the threshold suggests /clear once, and never over a person's attention line", () => {
	assert.equal(handoffNote(status, 249_999, 250_000), undefined);
	assert.equal(handoffNote(status, 250_000, 250_000), status.replace("attention: none", "attention: session handoff suggested; approve with /clear"));
	assert.equal(handoffNote(status.replace("attention: none", "attention: pick a date format"), 300_000, 250_000), undefined);
});

test("no handoff is suggested while background work runs", () => {
	assert.equal(handoffNote(status, 300_000, 250_000, true), undefined);
});

test("a clear that approves the suggestion records the fresh session", () => {
	const suggested = handoffNote(status, 250_000, 250_000) ?? "";

	assert.equal(clearedNote(suggested), status.replace("attention: none", "attention: session handoff complete; fresh session idle"));
});

test("a clear nobody suggested leaves the attention line alone", () => {
	assert.equal(clearedNote(status), undefined);
	assert.equal(clearedNote(status.replace("attention: none", "attention: pick a date format")), undefined);
});

function container(t: TestContext, status: string) {
	const root = mkdtempSync(join(tmpdir(), "claude-hooks-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const task = join(root, "claude-a");
	mkdirSync(task);
	writeFileSync(join(task, "status.md"), status);
	const script = join(import.meta.dirname, "../../claude/hooks/container.ts");
	const hook = (event: string, input = "{}") => execFileSync(process.execPath, [script, event], { input, env: { ...process.env, FLEET_ARTIFACTS: root, SANDBOX_NAME: "claude-a" } });
	const kept = () => (existsSync(join(task, "logs/status")) ? readdirSync(join(task, "logs/status")).sort().map((name) => readFileSync(join(task, "logs/status", name), "utf8")) : []);
	return { task, hook, kept };
}

test("each tool call keeps a changed status.md as a version, and a session start alone keeps none", (t) => {
	const { task, hook, kept } = container(t, "status: new\nattention: none\n");

	hook("session-start");
	const afterStart = kept();
	writeFileSync(join(task, "status.md"), "status: analyzing\nattention: none\n");
	hook("post-tool-use");
	hook("post-tool-use");

	assert.deepEqual(afterStart, []);
	assert.deepEqual(kept(), ["status: analyzing\nattention: none\n"]);
});

test("the end of a turn keeps a status.md change that no tool call reported", (t) => {
	const { task, hook, kept } = container(t, "status: analyzing\nattention: none\n");

	writeFileSync(join(task, "status.md"), "status: ready-for-host\nattention: none\n");
	hook("stop");

	assert.deepEqual(kept(), ["status: ready-for-host\nattention: none\n"]);
});

test("a session that stops on an API error keeps its blocked status as a version", (t) => {
	const { hook, kept } = container(t, "status: implementing\nattention: none\n");

	hook("stop-failure", JSON.stringify({ error: "402 Payment Required" }));

	assert.deepEqual(kept(), ["status: blocked\nattention: the agent stopped on an error before done: 402 Payment Required\n"]);
});
