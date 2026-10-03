import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import hostExtension from "../../pi/extensions.ts";

test("the host asks before closing the removal container", async (t) => {
	const sandbox = "claude-harness-remove-pi-lens";
	const command = `fleet down ${sandbox}`;
	const sessionId = "01a1038b-1df1-7616-ab9a-cd4ae75345c0";
	const previousSeat = process.env.FLEET_SEAT;
	const previousSession = process.env.PI_SESSION_ID;
	const handlers = new Map<string, ((event: any, ctx: any) => any)[]>();
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
	let approved = true;
	let confirmations = 0;
	const context = {
		cwd: process.cwd(),
		hasUI: true,
		sessionManager: { getSessionId: () => sessionId },
		ui: { confirm: async (title: string, message: string) => {
			assert.equal(title, "Close container?");
			assert.equal(message, `Run fleet down ${sandbox}?`);
			confirmations++;
			return approved;
		} },
	};
	handlers.get("session_start")![0]({}, context);
	const invoke = async (command: string) => {
		const event = { toolName: "bash", input: { command, timeout: 60 } };
		let result;
		for (const handler of handlers.get("tool_call")!) {
			result = await handler(event, context);
			if (result?.block) break;
		}
		return { event, result };
	};

	const allowed = await invoke(command);

	assert.equal(allowed.result?.block, undefined, allowed.result?.reason);
	assert.equal(confirmations, 1);
	assert.equal(allowed.event.input.command, `export FLEET_SEAT=pi PI_SESSION_ID="${sessionId}"; ${command}`);

	approved = false;
	const refused = await invoke(command);

	assert.equal(refused.result?.block, true);
	assert.equal(refused.result?.reason, `Ask the person before closing ${sandbox}.`);
	assert.equal(refused.event.input.command, command);
	assert.equal(confirmations, 2);

	context.hasUI = false;
	const withoutUI = await invoke(command);

	assert.equal(withoutUI.result?.block, true);
	assert.equal(withoutUI.result?.reason, `Ask the person before closing ${sandbox}.`);
	assert.equal(withoutUI.event.input.command, command);
	assert.equal(confirmations, 2);

	context.hasUI = true;
	approved = true;
	for (const wrapped of [
		`bash -c '${command}'`, `env ${command}`, `cd /tmp && ${command}`,
		`${command} && echo done`, `${command}; echo done`, `${command} | tail`,
		`${command}\necho done`, `${command} --force`, `${command} another`,
	]) {
		const denied = await invoke(wrapped);

		assert.equal(denied.result?.block, true, wrapped);
		assert.equal(denied.event.input.command, wrapped);
		assert.equal(confirmations, 2);
	}
});
