import assert from "node:assert/strict";
import { test } from "node:test";
import { PRIVATE_REPO } from "../profile/fixture.ts";
import { checkout, EMPTY_HOME, privateRoot } from "./checkouts.ts";
import guard from "../../extensions/guard.ts";
import { KINDS } from "../harness.ts";

type Verdict = { block: boolean; reason: string } | undefined;
type Handler = (
	event: { toolName: string; input?: Record<string, unknown> },
	ctx: { cwd: string },
) => Verdict;

function handler(
	root?: string,
	harness = KINDS.pi,
): (event: Parameters<Handler>[0], ctx?: { cwd: string }) => Verdict {
	let captured: Handler | undefined;
	guard(
		harness,
		root,
		EMPTY_HOME,
	)({
		on: (_event, fn) => {
			captured = fn as Handler;
		},
	});
	assert.ok(captured, "the extension registered no tool_call handler");

	return (event, ctx = { cwd: process.cwd() }) => captured!(event, ctx);
}

test("the extension blocks what the policy denies and stays out of the way otherwise", () => {
	const guard = handler();

	assert.equal(
		guard({ toolName: "bash", input: { command: "ls -la" } }),
		undefined,
	);
	assert.equal(
		guard({ toolName: "fleet_watch", input: { agents: "" } }),
		undefined,
	);

	const denied = guard({
		toolName: "bash",
		input: { command: "git push --force origin main" },
	});
	assert.equal(denied?.block, true);
	assert.match(denied?.reason ?? "", /force, delete or mirror push/);

	const unknown = guard({ toolName: "telepathy", input: { thought: "x" } });
	assert.equal(unknown?.block, true);
	assert.match(unknown?.reason ?? "", /Unknown tool policy: telepathy/);
});

test("a wait tool stays unknown to pi's guard", () => {
	const wait = { toolName: "wait", input: { ids: ["job-1"] } };

	assert.match(handler()(wait)?.reason ?? "", /Unknown tool policy: wait/);
});

test("pi's guard lets a codemode script run and still judges each command it calls", () => {
	const guard = handler();
	const script = { toolName: "codemode", input: { code: "return await tools.bash({ command: 'git push --force' })" } };

	const verdicts = [guard(script), guard({ toolName: "bash", input: { command: "git push --force" } })];

	assert.equal(verdicts[0], undefined);
	assert.equal(verdicts[1]?.block, true);
});

test("a denied command comes back blocked with the reason the policy gave", () => {
	const guard = handler();

	const denied = guard({
		toolName: "bash",
		input: { command: "gh pr create --title x" },
	});

	assert.equal(denied?.block, true);
	assert.match(denied?.reason ?? "", /push by another name/);
});

test("the extension judges a pull request by the profile of the directory the agent works in", () => {
	const guard = handler(privateRoot());
	const merge = {
		toolName: "bash",
		input: { command: "gh pr merge 12 --squash" },
	};

	const own = guard(merge, {
		cwd: checkout(`git@github.com:${PRIVATE_REPO}.git`),
	});
	const work = guard(merge, {
		cwd: checkout("git@github.com:acme/webapp.git"),
	});

	assert.equal(own, undefined);
	assert.equal(work?.block, true);
});

test("pi asks the person before a human down, but lets auto choose and refuses none", async () => {
	const root = privateRoot();
	const command = {
		toolName: "bash",
		input: { command: "fleet down pi-harness-demo" },
	};
	const call = (
		level: "auto" | "human" | "none",
		approved = true,
		hasUI = true,
	) => {
		let captured:
			| ((
					event: typeof command,
					ctx: {
						cwd: string;
						hasUI: boolean;
						ui: { confirm(title: string, message: string): Promise<boolean> };
					},
			  ) => unknown)
			| undefined;
		guard(KINDS.pi, root, EMPTY_HOME, () => ({
			sandbox: "pi-harness-demo",
			level,
		}))({
			on: (_event, fn) => {
				captured = fn as typeof captured;
			},
		});
		assert.ok(captured);
		return captured(command, {
			cwd: root,
			hasUI,
			ui: {
				confirm: async (title, message) => {
					assert.equal(title, "Close container?");
					assert.match(message, /pi-harness-demo/);
					return approved;
				},
			},
		});
	};

	assert.equal(await call("auto"), undefined);
	assert.equal(await call("human"), undefined);
	assert.match(
		((await call("human", false)) as { reason: string }).reason,
		/Ask the person/,
	);
	assert.match(
		((await call("human", true, false)) as { reason: string }).reason,
		/Ask the person/,
	);
	assert.match(
		((await call("none")) as { reason: string }).reason,
		/leaves fleet down to the person/,
	);
});

test("pi asks separately for landing, signing and pushing a sandbox", async () => {
	const root = privateRoot();
	let captured:
		| ((
				event: { toolName: string; input: { command: string } },
				ctx: {
					cwd: string;
					hasUI?: boolean;
					ui?: { confirm(title: string, message: string): Promise<boolean> };
				},
		  ) => unknown)
		| undefined;
	guard(
		KINDS.pi,
		root,
		EMPTY_HOME,
	)({
		on: (_event, fn) => {
			captured = fn as typeof captured;
		},
	});
	assert.ok(captured);
	for (const [command, action] of [
		["fleet land pi-harness-demo", "import, signing per profile"],
		["fleet land pi-harness-demo --sign", "import and sign"],
		["fleet land pi-harness-demo --push", "import and push, signing per profile"],
		["fleet land --sign --push pi-harness-demo", "import, sign and push"],
	]) {
		let prompted = false;
		assert.equal(
			await captured(
				{ toolName: "bash", input: { command } },
				{
					cwd: root,
					hasUI: true,
					ui: {
						confirm: async (_title, message) => {
							assert.match(message, new RegExp(action));
							prompted = true;
							return true;
						},
					},
				},
			),
			undefined,
		);
		assert.ok(prompted, command);
	}
	assert.equal(
		(
			(await captured(
				{
					toolName: "bash",
					input: { command: "fleet land pi-harness-demo --push" },
				},
				{ cwd: root },
			)) as { block?: boolean } | undefined
		)?.block,
		true,
	);
	assert.equal(
		(
			(await captured(
				{
					toolName: "bash",
					input: { command: "bash -c 'fleet land pi-harness-demo'" },
				},
				{ cwd: root },
			)) as { block?: boolean } | undefined
		)?.block,
		true,
	);
});

test("pi checks the raw down command before bash prepends input.cwd", () => {
	const root = privateRoot();
	let captured:
		| ((
				event: { toolName: string; input: Record<string, unknown> },
				ctx: { cwd: string },
		  ) => unknown)
		| undefined;
	guard(KINDS.pi, root, EMPTY_HOME, () => ({
		sandbox: "pi-harness-demo",
		level: "auto",
	}))({
		on: (_event, fn) => {
			captured = fn as typeof captured;
		},
	});
	assert.ok(captured);
	assert.equal(
		captured(
			{
				toolName: "bash",
				input: { command: "fleet down pi-harness-demo", cwd: "/tmp" },
			},
			{ cwd: root },
		),
		undefined,
	);
});

test("the extension refuses a force push where the profile lets the host push on its own", () => {
	const guard = handler(privateRoot());

	const denied = guard(
		{ toolName: "bash", input: { command: "git push -uf origin main" } },
		{ cwd: checkout(`git@github.com:${PRIVATE_REPO}.git`) },
	);

	assert.match(denied?.reason ?? "", /force, delete or mirror push/);
});

test("the extension refuses an edit or a shell write of the host's permissions and lets it read them", () => {
	const root = privateRoot();
	const guard = handler(root);

	const edit = guard(
		{ toolName: "edit", input: { path: "host/repos.json" } },
		{ cwd: root },
	);
	const shell = guard(
		{
			toolName: "bash",
			input: { command: "sed -i s/none/auto/ host/repos.json" },
		},
		{ cwd: root },
	);
	const read = guard(
		{ toolName: "read", input: { path: "host/repos.json" } },
		{ cwd: root },
	);
	const mine = ["edit", "write"].map((toolName) =>
		guard(
			{ toolName, input: { path: "~/.fleet/config/repos.json" } },
			{ cwd: root },
		),
	);

	for (const refusal of [edit, shell, ...mine])
		assert.match(refusal?.reason ?? "", /only the person changes them/);
	assert.equal(read, undefined);
	assert.equal(
		guard(
			{ toolName: "read", input: { path: "~/.fleet/config/repos.json" } },
			{ cwd: root },
		),
		undefined,
	);
});

test("pi refuses an edit or a shell redirect into its own home, and leaves reads and the fleet cache alone", () => {
	const home = "/Users/me";
	let captured: Handler | undefined;
	guard(
		KINDS.pi,
		undefined,
		home,
	)({
		on: (_event, fn) => {
			captured = fn as Handler;
		},
	});
	const ask = (
		toolName: string,
		input: Record<string, unknown>,
		cwd = "/Users/me/Work/app",
	) => captured!({ toolName, input }, { cwd });

	for (const [toolName, input, cwd] of [
		["edit", { path: "~/.pi/agent/settings.json" }],
		["write", { path: "/Users/me/.pi/skills/host/grilling/SKILL.md" }],
		["edit", { path: "settings.json" }, "/Users/me/.pi/agent"],
		["bash", { command: "echo x > ~/.pi/agent/AGENTS.md" }],
		["bash", { command: "printf y >> $HOME/.pi/agent/config.yml" }],
		["bash", { command: "cd ~/.pi/agent && echo '{}' >settings.json" }],
		["bash", { command: "sed -i s/a/b/ ~/.pi/agent/settings.json" }],
		["bash", { command: "echo x | tee ~/.pi/agent/config.yml" }],
		[
			"bash",
			{
				command:
					"jq '.x=1' ~/.pi/agent/settings.json > /tmp/s && mv /tmp/s ~/.pi/agent/settings.json",
			},
		],
		["bash", { command: "cp AGENTS.md /Users/me/.pi/agent/AGENTS.md" }],
		["bash", { command: 'echo x > "$HOME"/.pi/agent/settings.json' }],
		["bash", { command: "echo x >& ~/.pi/agent/AGENTS.md" }],
		["bash", { command: "echo x &> ~/.pi/agent/AGENTS.md" }],
		["bash", { command: "echo x >| ~/.pi/agent/AGENTS.md" }],
		["bash", { command: 'bash -c "cd ~/.pi && echo x > agent/AGENTS.md"' }],
		["bash", { command: "cd -- ~/.pi && touch agent/x" }],
		["bash", { command: "echo x > ~/.PI/agent/AGENTS.md" }],
	] as [string, Record<string, unknown>, string?][])
		assert.match(
			ask(toolName, input, cwd)?.reason ?? "",
			/harness renders/,
			JSON.stringify(input),
		);

	assert.equal(ask("read", { path: "~/.pi/agent/settings.json" }), undefined);
	assert.equal(
		ask("bash", { command: "cat ~/.pi/agent/config.yml > /tmp/config.yml" }),
		undefined,
	);
	assert.equal(ask("bash", { command: "echo x > ~/.fleet/cache/pi/note" }), undefined);
	assert.equal(ask("edit", { path: "src/app.ts" }), undefined);
	assert.equal(ask("bash", { command: "npm test > out.log 2>&1" }), undefined);
	assert.equal(ask("bash", { command: "rg '> ~/.pi' src" }), undefined);
	assert.equal(
		ask("bash", {
			command: 'git commit -m "refuse echo x > ~/.pi/agent/AGENTS.md"',
		}),
		undefined,
	);
	assert.equal(ask("bash", { command: "grep -r model ~/.pi/agent" }), undefined);
});
