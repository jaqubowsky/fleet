import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import handoff, { COMPLETE, suggested } from "../../extensions/session-handoff.ts";
import { clearedNote } from "../../claude/hooks/container.ts";
import { fakeIo } from "./fake-io.ts";
import { renderText, seatSettings } from "../render/render.ts";
import { HARNESSES } from "../harness.ts";

async function runtime(t: TestContext, { settings = "{}", replaces = true } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "session-handoff-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const taskDirectory = dir;
	const status = "status: implementing\nattention: none\n\n## Summary\nThe fix passes. Review remains; see [analysis](analysis.md).\n\n## Next step\nRun two-axis-review.\n\n## Log\n";
	writeFileSync(join(dir, "status.md"), status);
	for (const [key, value] of Object.entries({ PI_CODING_AGENT_DIR: dir, FLEET_ARTIFACTS: dir, SANDBOX_NAME: "." })) {
		const previous = process.env[key];
		process.env[key] = value;
		t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
	}
	writeFileSync(join(dir, "settings.json"), settings);
	const events: Record<string, (...args: any[]) => any> = {};
	const commands: Record<string, { handler: (...args: any[]) => any }> = {};
	const sent: any[] = [];
	const prompts: string[] = [];
	let tokens: number | null | undefined;
	let attempts = 0;
	let sessions = 0;
	let cancelled = false;
	let idle = Promise.resolve();
	let editor = "draft typed during the previous turn";
	const ui = { setEditorText: (text: string) => { editor = text; } };
	const into = { ui, sendMessage: async (message: any, options: any) => sent.push({ message, options }), sendUserMessage: async (text: string) => prompts.push(text) };
	const ctx = {
		ui,
		waitForIdle: () => idle,
		getContextUsage: () => tokens === undefined ? undefined : { tokens },
		sessionManager: { getSessionFile: () => "/sessions/previous.jsonl" },
		newSession: async (options: any) => {
			attempts++;
			if (cancelled) return { cancelled: true };
			sessions++;
			assert.equal(options.parentSession, "/sessions/previous.jsonl");
			if (replaces) await options.withSession(into);
			return { cancelled: false };
		},
	};
	await handoff({
		on: (name: string, fn: any) => { events[name] = fn; },
		registerCommand: (name: string, command: any) => { commands[name] = command; },
		sendMessage: replaces ? () => assert.fail("the old session's API is stale after a replacement") : into.sendMessage,
		sendUserMessage: replaces ? () => assert.fail("the old session's API is stale after a replacement") : into.sendUserMessage,
	}, async (_path, mutation) => mutation());
	return {
		ctx, taskDirectory, status, sent, prompts,
		usage: (value: typeof tokens) => { tokens = value; },
		suggest: () => writeFileSync(join(dir, "status.md"), status.replace("attention: none", `attention: ${suggested("/session-handoff")}`)),
		approve: (args = "") => commands["session-handoff"].handler(args, ctx),
		cancel: () => { cancelled = true; },
		busy: () => {
			let finish!: () => void;
			idle = new Promise<void>((resolve) => { finish = resolve; });
			return finish;
		},
		state: () => ({ attempts, sessions }),
		editor: () => editor,
		readStatus: () => readFileSync(join(dir, "status.md"), "utf8"),
		turnEnd: () => events.turn_end?.({}, ctx),
	};
}

const pointer = (dir: string) => ({
	customType: "session-handoff",
	content: `Previous task directory: ${JSON.stringify(dir)}. This is optional background. If the user's next message asks to continue or refers to this task, read its current durable artifacts. For unrelated work, ignore it.`,
	display: false,
});

test("a context past the threshold says once, mid-turn, that the next natural break is worth a handoff, and again after it drops", async (t) => {
	const r = await runtime(t, { replaces: false });

	for (const tokens of [undefined, null, 249999, 250000, 300000]) {
		r.usage(tokens);
		r.turnEnd();
	}
	const once = [...r.sent];
	for (const tokens of [1000, 300000]) {
		r.usage(tokens);
		r.turnEnd();
	}

	assert.equal(once.length, 1);
	assert.deepEqual(once[0].options, { deliverAs: "steer" });
	assert.equal(once[0].message.content, "The context has passed 250000 tokens, and every turn now reads all of it again: suggest a session handoff at the next natural break, as your Session handoff rule describes.");
	assert.equal(r.sent.length, 2);
	assert.equal(r.readStatus(), r.status);
	assert.deepEqual(r.state(), { attempts: 0, sessions: 0 });
});

test("a context that keeps growing hears it again at every further 100k tokens", async (t) => {
	const r = await runtime(t, { replaces: false });

	for (const tokens of [250000, 349999, 350000, 360000, 470000]) {
		r.usage(tokens);
		r.turnEnd();
	}

	assert.deepEqual(r.sent.map((sent) => sent.message.content.match(/passed (\d+) tokens/)?.[1]), ["250000", "350000", "450000"]);
});

test("sandbox uses an overridden rendered threshold", async (t) => {
	const io = fakeIo({
		"read /root/pi/profiles/settings.json": '{"unknown":{"keep":true}}',
		"read /root/pi/profiles/sbx.json": '{"sessionHandoff":{"suggestAtTokens":84}}',
	});
	const r = await runtime(t, { settings: seatSettings(io, "/root", HARNESSES.pi, "sbx.json"), replaces: false });

	r.usage(83);
	r.turnEnd();
	const below = r.sent.length;
	r.usage(84);
	r.turnEnd();

	assert.equal(below, 0);
	assert.match(r.sent[0].message.content, /passed 84 tokens/);
});

test("the command opens an idle fresh session holding only hidden optional context", async (t) => {
	const r = await runtime(t);
	r.suggest();

	await r.approve();

	assert.deepEqual(r.sent, [{ message: pointer(r.taskDirectory), options: { triggerTurn: false } }]);
	assert.deepEqual(r.prompts, []);
	assert.equal(r.editor(), "");
	assert.match(r.readStatus(), /^attention: session handoff complete; fresh session idle$/m);
	assert.deepEqual(r.state(), { attempts: 1, sessions: 1 });
});

test("the attention note the command writes is kept as a version", async (t) => {
	const r = await runtime(t);
	r.suggest();

	await r.approve();

	const dir = join(r.taskDirectory, "logs/status");
	const kept = readdirSync(dir).sort().map((name) => readFileSync(join(dir, name), "utf8"));
	assert.equal(kept.length, 1);
	assert.match(kept[0], /^attention: session handoff complete; fresh session idle$/m);
});

test("text after the command becomes the fresh session's first prompt", async (t) => {
	const r = await runtime(t);

	await r.approve("  Continue the previous task: read current durable artifacts.  ");

	assert.deepEqual(r.sent, [{ message: pointer(r.taskDirectory), options: { triggerTurn: false } }]);
	assert.deepEqual(r.prompts, ["Continue the previous task: read current durable artifacts."]);
});

test("a runtime that keeps its session object reaches the fresh session through the extension API", async (t) => {
	const r = await runtime(t, { replaces: false });

	await r.approve("Continue.");

	assert.deepEqual(r.sent, [{ message: pointer(r.taskDirectory), options: { triggerTurn: false } }]);
	assert.deepEqual(r.prompts, ["Continue."]);
	assert.equal(r.editor(), "");
	assert.match(r.readStatus(), /^attention: session handoff complete; fresh session idle$/m);
});

test("the command waits for the old turn to finish", async (t) => {
	const r = await runtime(t);
	const finish = r.busy();

	const command = r.approve();

	assert.equal(r.state().sessions, 0);
	finish();
	await command;
	assert.equal(r.state().sessions, 1);
});

test("a cancelled replacement reports that it stayed put", async (t) => {
	const r = await runtime(t);
	r.suggest();
	r.cancel();

	await r.approve("Continue.");

	assert.deepEqual(r.sent, []);
	assert.deepEqual(r.prompts, []);
	assert.deepEqual(r.state(), { attempts: 1, sessions: 0 });
	assert.match(r.readStatus(), /^attention: session handoff cancelled; still in the previous session$/m);
});

test("every harness's container rule suggests a handoff with the command its host is told to steer", () => {
	const rule = readFileSync("sbx/container/sandbox.md", "utf8");
	const claude = `status: implementing\nattention: ${suggested(HARNESSES.claude.tokens["handoff.command"])}\n`;

	const rendered = Object.values(HARNESSES).map((harness) => ({ harness, text: renderText(rule, { ...harness.tokens, cli: harness.cli }, (name) => readFileSync(`fragments/${name}.md`, "utf8"), "sandbox.md") }));

	for (const { harness, text } of rendered) assert.ok(text.includes(`attention: ${suggested(harness.tokens["handoff.command"])}`), harness.name);
	assert.match(clearedNote(claude) ?? "", new RegExp(`^attention: ${COMPLETE}$`, "m"));
});

test("handoff is loaded only through the sandbox profile and image", () => {
	const sandbox = JSON.parse(readFileSync("pi/profiles/sbx.json", "utf8"));
	const host = JSON.parse(readFileSync("pi/profiles/host.json", "utf8"));
	assert.deepEqual(sandbox.extensions, ["../sbx/extensions/session-handoff.ts"]);
	assert.ok(!(host.extensions ?? []).some((path: string) => path.includes("session-handoff")));
	assert.equal(sandbox.sessionHandoff.suggestAtTokens, 250000);
	assert.match(readFileSync("pi/sbx/Dockerfile", "utf8"), /COPY.*extensions\/\s+\/home\/agent\/\.pi\/sbx\/extensions\//);
});
