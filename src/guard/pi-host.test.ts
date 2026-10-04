import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { test, type TestContext } from "node:test";
import hostExtension from "../../pi/extensions.ts";
import { answer as claudeAnswer } from "../../claude/hooks/guard.ts";
import { PRIVATE_PROFILE } from "../profile/fixture.ts";

function hostRuntime(t: TestContext, sandbox = "pi-harness-remove-pi-lens") {
	const sessionId = "01a1038b-1df1-7616-ab9a-cd4ae75345c0";
	const previousSeat = process.env.FLEET_SEAT;
	const previousSession = process.env.PI_SESSION_ID;
	const handlers = new Map<string, ((event: any, ctx: any) => any)[]>();
	const readFileSync = fs.readFileSync;
	t.mock.method(childProcess, "spawnSync", (file: string, args: string[]) => {
		assert.equal(file, "sbx");
		assert.deepEqual(args, ["ls", "--json"]);
		return { status: 0, stdout: '{"sandboxes":[]}', stderr: "" };
	});
	t.mock.method(childProcess, "execFileSync", (file: string, args: string[]) => {
		if (file === "sbx") {
			assert.deepEqual(args, ["ls", "--json"]);
			return JSON.stringify({ sandboxes: [{ name: sandbox, workspaces: [process.cwd()] }] });
		}
		assert.equal(file, "git");
		assert.deepEqual(args, ["-C", process.cwd(), "config", "--get-regexp", "^remote\\."]);
		return "remote.origin.url git@github.com:jaqubowsky/fleet.git\n";
	});
	t.mock.method(fs, "readFileSync", (path: fs.PathOrFileDescriptor, options: any) => {
		if (/\/(host|\.fleet\/config)\/repos\.json$/.test(String(path)))
			return JSON.stringify({ "*": PRIVATE_PROFILE });
		return readFileSync(path, options);
	});
	t.mock.method(fs, "watchFile", () => undefined);
	t.mock.method(fs, "unwatchFile", () => undefined);
	syncBuiltinESMExports();
	t.after(() => {
		for (const handler of handlers.get("session_shutdown") ?? []) handler({}, {});
		if (previousSeat === undefined) delete process.env.FLEET_SEAT;
		else process.env.FLEET_SEAT = previousSeat;
		if (previousSession === undefined) delete process.env.PI_SESSION_ID;
		else process.env.PI_SESSION_ID = previousSession;
		t.mock.restoreAll();
		syncBuiltinESMExports();
	});
	hostExtension({
		on: (name: string, handler: (event: any, ctx: any) => any) => {
			handlers.set(name, [...handlers.get(name) ?? [], handler]);
		},
		registerTool() {},
		registerCommand() {},
	});
	const context = {
		cwd: process.cwd(),
		hasUI: true,
		sessionManager: { getSessionId: () => sessionId },
		ui: { confirm: async (_title: string, _message: string): Promise<boolean> => {
			throw new Error("Unexpected approval prompt");
		} },
	};
	handlers.get("session_start")![0]({}, context);
	const invoke = async (command: string, timeout = 60) => {
		const event = { toolName: "bash", input: { command, timeout } };
		let result;
		for (const handler of handlers.get("tool_call")!) {
			result = await handler(event, context);
			if (result?.block) break;
		}
		return { event, result };
	};
	return { context, invoke, sessionId };
}

for (const { name, sandbox, command, timeout, title, message, reason } of [
	{
		name: "the host asks before closing the removal container",
		sandbox: "claude-harness-remove-pi-lens",
		command: "fleet down claude-harness-remove-pi-lens",
		timeout: 60,
		title: "Close container?",
		message: "Run fleet down claude-harness-remove-pi-lens?",
		reason: "Ask the person before closing claude-harness-remove-pi-lens.",
	},
	{
		name: "the host asks before closing a full-length pi sandbox",
		sandbox: "pi-wpasuj-wpa-118-a-guide-page-for-jak-ustalic-termin-spotkania",
		command: "fleet down pi-wpasuj-wpa-118-a-guide-page-for-jak-ustalic-termin-spotkania",
		timeout: 60,
		title: "Close container?",
		message: "Run fleet down pi-wpasuj-wpa-118-a-guide-page-for-jak-ustalic-termin-spotkania?",
		reason: "Ask the person before closing pi-wpasuj-wpa-118-a-guide-page-for-jak-ustalic-termin-spotkania.",
	},
	{
		name: "the host asks before landing and pushing the removal branch",
		sandbox: "pi-harness-remove-pi-lens",
		command: "fleet land pi-harness-remove-pi-lens --push",
		timeout: 180,
		title: "Land container?",
		message: "import and push, signing per profile pi-harness-remove-pi-lens?",
		reason: "Ask the person before the import and push, signing per profile for pi-harness-remove-pi-lens.",
	},
]) {
	test(name, async (t) => {
		const { context, invoke, sessionId } = hostRuntime(t, sandbox);
		let approved = true;
		let confirmations = 0;
		context.ui.confirm = async (requestedTitle, requestedMessage) => {
			assert.equal(requestedTitle, title);
			assert.equal(requestedMessage, message);
			confirmations++;
			return approved;
		};

		const allowed = await invoke(command, timeout);

		assert.equal(allowed.result?.block, undefined, allowed.result?.reason);
		assert.equal(confirmations, 1);
		assert.equal(allowed.event.input.command, `export FLEET_SEAT=pi PI_SESSION_ID="${sessionId}"; ${command}`);
		assert.equal(allowed.event.input.timeout, timeout);
		const claude = JSON.parse(claudeAnswer({ tool_name: "Bash", tool_input: { command, timeout } })).hookSpecificOutput;
		assert.equal(claude.permissionDecision, "ask");
		assert.equal(claude.permissionDecisionReason, reason);

		approved = false;
		const refused = await invoke(command, timeout);

		assert.equal(refused.result?.block, true);
		assert.equal(refused.result?.reason, reason);
		assert.equal(refused.event.input.command, command);
		assert.equal(confirmations, 2);

		context.hasUI = false;
		const withoutUI = await invoke(command, timeout);

		assert.equal(withoutUI.result?.block, true);
		assert.equal(withoutUI.result?.reason, reason);
		assert.equal(withoutUI.event.input.command, command);
		assert.equal(confirmations, 2);

		context.hasUI = true;
		approved = true;
		for (const wrapped of [
			`bash -c '${command}'`, `env ${command}`, `cd /tmp && ${command}`,
			`${command} && echo done`, `${command}; echo done`, `${command} | tail`,
			`${command}\necho done`, `${command} --force`, `${command} another`,
		]) {
			const denied = await invoke(wrapped, timeout);

			assert.equal(denied.result?.block, true, wrapped);
			assert.equal(denied.event.input.command, wrapped);
			assert.equal(confirmations, 2);
			const claude = JSON.parse(claudeAnswer({ tool_name: "Bash", tool_input: { command: wrapped } })).hookSpecificOutput;
			assert.equal(claude.permissionDecision, "deny", wrapped);
		}
	});
}

for (const { name, command } of [
	{ name: "automatic PR creation keeps fleet text in its title", command: "gh pr create --title 'fix fleet attribution'" },
	{ name: "automatic PR merging keeps fleet text in its subject", command: "gh pr merge 12 --subject 'fix fleet attribution'" },
	{ name: "reading permission profiles keeps fleet text in the search", command: "grep 'the fleet profile' host/repos.json" },
	{ name: "automatic push accepts a branch named fleet", command: "git push origin fleet topic" },
	{ name: "read-only git accepts fleet text in its search", command: "git log --grep='fix fleet attribution'" },
	{ name: "reading agent settings accepts fleet text in its search", command: "grep 'the fleet profile' ~/.pi/agent/settings.json" },
	{ name: "automatic PR closing needs no fleet attribution", command: "gh pr close 12" },
]) {
	test(name, async (t) => {
		const { invoke } = hostRuntime(t);

		const verdict = await invoke(command);
		const claude = claudeAnswer({ tool_name: "Bash", tool_input: { command } });

		assert.equal(verdict.result?.block, undefined, verdict.result?.reason);
		if (claude) assert.equal(JSON.parse(claude).hookSpecificOutput.permissionDecision, "allow");
	});
}

for (const command of [
	"echo ready && gh pr create --title 'fix fleet attribution'",
	"bash -c \"gh pr merge 12 --subject 'fix fleet attribution'\"",
	"gh pr create --repo someone/else --title 'fix fleet attribution'",
	'gh pr merge 12 --subject "$HOME fleet attribution"',
	"git push --force origin fleet topic",
	"echo fleet profile > host/repos.json",
	"echo fleet profile > ~/.pi/agent/settings.json",
	"sbx rm pi-harness-remove-pi-lens",
]) {
	test(`both host guards refuse ${command}`, async (t) => {
		const { invoke } = hostRuntime(t);

		const verdict = await invoke(command);
		const claude = JSON.parse(claudeAnswer({ tool_name: "Bash", tool_input: { command } })).hookSpecificOutput;

		assert.equal(verdict.result?.block, true);
		assert.equal(verdict.event.input.command, command);
		assert.equal(claude.permissionDecision, "deny");
	});
}
