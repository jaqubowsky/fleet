import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import handoff, { COMPLETE, suggested } from "../../extensions/session-handoff.ts";
import { clearedNote, handoffNote } from "../../claude/hooks/container.ts";
import { fakeIo } from "./fake-io.ts";
import { seatSettings } from "../render/render.ts";
import { HARNESSES } from "../harness.ts";
import { brief } from "./status.ts";

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
	const tools: Record<string, { execute: (...args: any[]) => any }> = {};
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
		registerTool: (tool: any) => { tools[tool.name] = tool; },
		sendMessage: replaces ? () => assert.fail("the old session's API is stale after a replacement") : into.sendMessage,
		sendUserMessage: replaces ? () => assert.fail("the old session's API is stale after a replacement") : into.sendUserMessage,
	}, async (_path, mutation) => mutation());
	return {
		ctx, taskDirectory, status, sent, prompts,
		usage: (value: typeof tokens) => { tokens = value; },
		suggest: () => tools.session_handoff.execute("call", {}, undefined, undefined, ctx),
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

test("a context past the threshold says once, mid-turn, that ending the session is worth it, and again after it drops", async (t) => {
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
	assert.equal(once[0].message.content, "The context has passed 250000 tokens, and every turn now reads all of it again. End this session at the next point where status.md and the task files hold what the work needs: call session_handoff.");
	assert.equal(r.sent.length, 2);
	assert.equal(r.readStatus(), r.status);
	assert.deepEqual(r.state(), { attempts: 0, sessions: 0 });
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

test("a suggestion reaches the host attention line with the command that approves it", async (t) => {
	const r = await runtime(t);

	const result = await r.suggest();

	assert.equal(result.terminate, true);
	assert.match(result.content[0].text, /\/session-handoff/);
	assert.match(brief(r.readStatus()), /attention: session handoff suggested; approve with \/session-handoff/);
	assert.equal(r.readStatus().replace(/^attention: .*$/m, "attention: none"), r.status);
	assert.deepEqual(r.state(), { attempts: 0, sessions: 0 });
});

test("the model cannot approve its own suggestion", async (t) => {
	const r = await runtime(t);

	await r.suggest();
	await r.suggest();

	assert.deepEqual(r.state(), { attempts: 0, sessions: 0 });
	assert.deepEqual(r.prompts, []);
});

test("the command opens an idle fresh session holding only hidden optional context", async (t) => {
	const r = await runtime(t);
	await r.suggest();

	await r.approve();

	assert.deepEqual(r.sent, [{ message: pointer(r.taskDirectory), options: { triggerTurn: false } }]);
	assert.deepEqual(r.prompts, []);
	assert.equal(r.editor(), "");
	assert.match(r.readStatus(), /^attention: session handoff complete; fresh session idle$/m);
	assert.deepEqual(r.state(), { attempts: 1, sessions: 1 });
});

test("each attention note the handoff writes is kept as a version, the command's own included", async (t) => {
	const r = await runtime(t);

	await r.suggest();
	await r.approve();

	const dir = join(r.taskDirectory, "logs/status");
	const kept = readdirSync(dir).sort().map((name) => readFileSync(join(dir, name), "utf8"));
	assert.equal(kept.length, 2);
	assert.match(kept[0], /^attention: session handoff suggested; approve with \/session-handoff$/m);
	assert.match(kept[1], /^attention: session handoff complete; fresh session idle$/m);
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
	await r.suggest();
	r.cancel();

	await r.approve("Continue.");

	assert.deepEqual(r.sent, []);
	assert.deepEqual(r.prompts, []);
	assert.deepEqual(r.state(), { attempts: 1, sessions: 0 });
	assert.match(r.readStatus(), /^attention: session handoff cancelled; still in the previous session$/m);
});

test("every harness suggests a handoff with the command its host is told to steer", async (t) => {
	const r = await runtime(t);
	await r.suggest();
	const claude = handoffNote(r.status, 250_000, 250_000) ?? "";

	for (const name of ["pi", "omp"] as const) assert.match(r.readStatus(), new RegExp(`^attention: ${suggested(HARNESSES[name].tokens["handoff.command"])}$`, "m"));
	assert.match(claude, new RegExp(`^attention: ${suggested(HARNESSES.claude.tokens["handoff.command"])}$`, "m"));
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
