import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import handoff from "../../sbx/extensions/session-handoff.ts";
import { fakeIo } from "./fake-io.ts";
import { render } from "./provider.ts";
import { brief } from "./status.ts";

function runtime(t: TestContext, settings = "{}") {
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
	const queued: any[] = [];
	const messages: any[] = [];
	let tokens: number | null | undefined;
	let attempts = 0;
	let sessions = 0;
	let cancelled = false;
	let idle = Promise.resolve();
	let editor = "draft typed during the previous turn";
	const ctx = {
		waitForIdle: () => idle,
		getContextUsage: () => tokens === undefined ? undefined : { tokens },
		sessionManager: { getSessionFile: () => "/sessions/previous.jsonl" },
		newSession: async (options: any) => {
			attempts++;
			if (cancelled) return { cancelled: true };
			sessions++;
			assert.equal(options.parentSession, "/sessions/previous.jsonl");
			assert.equal(options.setup, undefined);
			await options.withSession({
				ui: { setEditorText: (text: string) => { assert.equal(text, ""); editor = text; } },
				sendMessage: async (message: any, options: any) => messages.push({ message, options }),
			});
			return { cancelled: false };
		},
	};
	handoff({
		on: (name: string, fn: any) => { events[name] = fn; },
		registerCommand: (name: string, command: any) => { commands[name] = command; },
		registerTool: (tool: any) => { tools[tool.name] = tool; },
		sendUserMessage: (text: string, options: any) => queued.push({ text, options }),
	});
	return {
		ctx, commands, tools, queued, messages, taskDirectory, status,
		usage: (value: typeof tokens) => { tokens = value; },
		input: (text: string, source = "interactive") => events.input?.({ text, source }, ctx),
		call: () => tools.session_handoff.execute("call", {}, undefined, undefined, ctx),
		cancel: () => { cancelled = true; },
		busy: () => {
			let finish!: () => void;
			idle = new Promise<void>((resolve) => { finish = resolve; });
			return finish;
		},
		state: () => ({ attempts, sessions }),
		editor: () => editor,
		readStatus: () => readFileSync(join(dir, "status.md"), "utf8"),
		prompt: () => events.before_agent_start?.({ systemPrompt: "Existing system prompt" }, ctx),
	};
}

test("context threshold adds only a neutral system advisory", async (t) => {
	const r = runtime(t);

	for (const tokens of [undefined, null, 249999]) {
		r.usage(tokens);
		assert.equal(await r.prompt(), undefined);
	}
	for (const tokens of [250000, 300000]) {
		r.usage(tokens);
		const result = await r.prompt();
		assert.ok(result?.systemPrompt.startsWith("Existing system prompt\n\n"));
		assert.match(result.systemPrompt, /appropriate handoff point/);
		assert.match(result.systemPrompt, /explicit approval/);
		assert.equal(result.message, undefined);
	}
	assert.equal(r.readStatus(), r.status);
	assert.deepEqual(r.queued, []);
	assert.deepEqual(r.messages, []);
	assert.deepEqual(r.state(), { attempts: 0, sessions: 0 });
});

test("sandbox uses an overridden rendered threshold", async (t) => {
	const io = fakeIo({
		"read /root/profiles/settings.json": '{"unknown":{"keep":true}}',
		"read /root/profiles/sbx.json": '{"sessionHandoff":{"suggestAtTokens":84}}',
	});
	render("/root", io);
	const r = runtime(t, io.files["/root/sbx/agent-settings.json"]);

	r.usage(83);
	assert.equal(await r.prompt(), undefined);
	r.usage(84);
	assert.ok((await r.prompt())?.systemPrompt);
});

test("a suggestion reaches the host attention line without duplicating task content", async (t) => {
	const r = runtime(t);

	const result = await r.call();

	assert.equal(result.terminate, true);
	assert.match(brief(r.readStatus()), /attention: session handoff requested; reply "Approve session handoff" to approve/);
	assert.equal(r.readStatus().replace(/^attention: .*$/m, "attention: none"), r.status);
	assert.deepEqual(r.queued, []);
	assert.equal(r.state().sessions, 0);
});

test("only explicit external approval permits the tool to queue the command", async (t) => {
	const r = runtime(t);
	await r.commands["session-handoff"].handler("", r.ctx);
	await r.call();
	r.input("Approve session handoff", "extension");
	await r.call();
	assert.deepEqual(r.queued, []);
	r.input("No, keep working");
	await r.call();
	assert.deepEqual(r.queued, []);
	r.input("Approve session handoff");
	const result = await r.call();
	await r.call();

	assert.equal(result.terminate, true);
	assert.deepEqual(r.queued, [{ text: "/session-handoff", options: { deliverAs: "followUp", expandPromptTemplates: true } }]);
	assert.equal(r.state().sessions, 0);
});

test("approved handoff leaves only hidden optional context in the idle replacement", async (t) => {
	const r = runtime(t);
	await r.call();
	r.input("Approve session handoff", "rpc");
	await r.call();
	await r.commands["session-handoff"].handler("", r.ctx);

	assert.deepEqual(r.messages, [{
		message: {
			customType: "session-handoff",
			content: `Previous task directory: ${JSON.stringify(r.taskDirectory)}. This is optional background. If the user's next message asks to continue or refers to this task, read its current durable artifacts. For unrelated work, ignore it.`,
			display: false,
		},
		options: { triggerTurn: false },
	}]);
	assert.match(r.readStatus(), /^attention: session handoff complete; fresh session idle$/m);
	await r.commands["session-handoff"].handler("", r.ctx);
	assert.deepEqual(r.state(), { attempts: 1, sessions: 1 });
	assert.equal(r.queued.length, 1);
	assert.equal(r.editor(), "");
});

test("the follow-up command waits for the old tool turn to finish", async (t) => {
	const r = runtime(t);
	await r.call();
	r.input("Approve session handoff");
	await r.call();
	const finish = r.busy();
	const command = r.commands["session-handoff"].handler("", r.ctx);

	assert.equal(r.state().sessions, 0);
	finish();
	await command;
	assert.equal(r.state().sessions, 1);
});

test("cancelled replacement consumes approval and reports that it stayed put", async (t) => {
	const r = runtime(t);
	await r.call();
	r.input("Approve session handoff");
	await r.call();
	r.cancel();
	await r.commands["session-handoff"].handler("", r.ctx);
	await r.commands["session-handoff"].handler("", r.ctx);

	assert.deepEqual(r.messages, []);
	assert.deepEqual(r.state(), { attempts: 1, sessions: 0 });
	assert.match(r.readStatus(), /^attention: session handoff cancelled; still in the previous session$/m);
});

test("handoff is loaded only through the sandbox profile and image", () => {
	assert.equal(existsSync("agent/extensions/session-handoff.ts"), false);
	const sandbox = JSON.parse(readFileSync("profiles/sbx.json", "utf8"));
	const host = JSON.parse(readFileSync("profiles/host.json", "utf8"));
	assert.deepEqual(sandbox.extensions, ["../sbx/extensions/session-handoff.ts"]);
	assert.equal(host.extensions, undefined);
	assert.equal(sandbox.sessionHandoff.suggestAtTokens, 250000);
	assert.match(readFileSync("sbx/Dockerfile", "utf8"), /COPY.*extensions\/\s+\/home\/agent\/\.pi\/sbx\/extensions\//);
});
