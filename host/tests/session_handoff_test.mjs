import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeIo } from "../../src/fleet/fake-io.ts";
import { seatSettings } from "../../src/render/render.ts";
import { HARNESSES } from "../../src/harness.ts";

const { createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices, createEditTool, SessionManager, SettingsManager } = await import(process.argv[2]);
const root = join(import.meta.dirname, "../..");
const io = fakeIo(Object.fromEntries(["settings", "models", "host", "sbx"].map((name) => [
	`read /root/pi/profiles/${name}.json`, readFileSync(join(root, `pi/profiles/${name}.json`), "utf8"),
])));
process.env.PI_OFFLINE = "1";

for (const seat of ["host", "sbx"]) {
	const dir = mkdtempSync(join(tmpdir(), `handoff-${seat}-`));
	const agentDir = join(dir, "agent");
	mkdirSync(agentDir);
	mkdirSync(join(dir, "sbx/extensions"), { recursive: true });
	for (const file of ["session-handoff.ts", "status-history.ts"]) copyFileSync(join(root, "extensions", file), join(dir, "sbx/extensions", file));
	const settings = JSON.parse(seatSettings(io, "/root", HARNESSES.pi, seat === "host" ? "host.json" : "sbx.json"));
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify(settings));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.FLEET_ARTIFACTS = dir;
	process.env.SANDBOX_NAME = "task";
	mkdirSync(join(dir, "task"));
	writeFileSync(join(dir, "task/status.md"), "status: implementing\nattention: none\n\n## Summary\nReady for review. Checks passed.\n\n## Next step\nRun two-axis-review.\n\n## Log\n");
	let turns = 0;
	let editor = "previous draft";
	let replacement;
	const errors = [];
	const factory = async ({ cwd, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({
			cwd, agentDir,
			settingsManager: SettingsManager.inMemory({ ...settings, packages: [], skills: [] }),
			resourceLoaderOptions: { noSkills: true, noPromptTemplates: true, agentsFilesOverride: () => ({ agentsFiles: [] }) },
		});
		return { ...await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, noTools: "builtin" }), services, diagnostics: services.diagnostics };
	};
	const runtime = await createAgentSessionRuntime(factory, { cwd: dir, agentDir, sessionManager: SessionManager.inMemory(dir) });
	const bind = async (session) => {
		session.subscribe((event) => { if (event.type === "agent_start") turns++; });
		await session.bindExtensions({
			mode: "tui",
			uiContext: {
				notify() {},
				setEditorText(text) { assert.equal(text, ""); editor = text; },
			},
			onError: (error) => errors.push(error),
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				newSession: (options) => { replacement = runtime.newSession(options); return replacement; },
			},
		});
	};
	runtime.setRebindSession(bind);
	try {
		await bind(runtime.session);
		const old = runtime.session;
		const tool = old.agent.state.tools.find((tool) => tool.name === "session_handoff");
		const extensions = runtime.services.resourceLoader.getExtensions().extensions;
		if (seat === "host") {
			assert.equal(settings.sessionHandoff, undefined);
			assert.equal(tool, undefined);
			assert.equal(extensions.some((extension) => extension.commands.has("session-handoff")), false);
			assert.equal(extensions.some((extension) => extension.handlers.has("turn_end")), false);
			assert.deepEqual(old.messages, []);
		} else {
			assert.ok(tool);
			assert.equal(extensions.some((extension) => extension.commands.has("session-handoff")), true);
			assert.equal(extensions.some((extension) => extension.handlers.has("turn_end")), true);
			const readStarted = Promise.withResolvers();
			const finishRead = Promise.withResolvers();
			const edit = createEditTool(dir, { operations: {
				access: async () => {},
				readFile: async (path) => {
					const snapshot = readFileSync(path);
					readStarted.resolve();
					await finishRead.promise;
					return snapshot;
				},
				writeFile: async (path, content) => { writeFileSync(path, content); },
			} });
			const editing = edit.execute("update-summary", { path: "task/status.md", edits: [{ oldText: "Ready for review.", newText: "Ready for independent review." }] });
			await readStarted.promise;
			const requesting = tool.execute("request", {});
			await new Promise((resolve) => setImmediate(resolve));
			finishRead.resolve();
			await Promise.all([editing, requesting]);
			assert.match(readFileSync(join(dir, "task/status.md"), "utf8"), /attention: session handoff suggested; approve with \/session-handoff/);
			assert.match(readFileSync(join(dir, "task/status.md"), "utf8"), /Ready for independent review\./);
			assert.equal(runtime.session, old);
			assert.equal(replacement, undefined);
			await old.prompt("/session-handoff");
			assert.ok(replacement);
			await replacement;
			assert.notEqual(runtime.session, old);
			assert.match(readFileSync(join(dir, "task/status.md"), "utf8"), /attention: session handoff complete; fresh session idle/);
			const versions = readdirSync(join(dir, "task/logs/status")).sort();
			assert.match(readFileSync(join(dir, "task/logs/status", versions.at(-1)), "utf8"), /attention: session handoff complete; fresh session idle/);
			assert.equal(runtime.session.isStreaming, false);
			assert.equal(runtime.session.pendingMessageCount, 0);
			assert.equal(editor, "");
			assert.equal(runtime.session.messages.length, 1);
			const message = runtime.session.messages[0];
			assert.equal(message.role, "custom");
			assert.equal(message.display, false);
			assert.equal(message.customType, "session-handoff");
			assert.match(message.content, /optional background/);
			assert.match(message.content, /For unrelated work, ignore it/);
		}
		assert.equal(turns, 0);
		assert.deepEqual(errors, []);
		console.log(`session handoff: ${seat} rendered setup passed`);
	} finally {
		await runtime.dispose();
		rmSync(dir, { recursive: true, force: true });
	}
}
