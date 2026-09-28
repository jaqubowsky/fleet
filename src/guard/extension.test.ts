import assert from "node:assert/strict";
import { test } from "node:test";
import { PRIVATE_REPO } from "../profile/fixture.ts";
import { checkout, EMPTY_HOME, privateRoot } from "./checkouts.ts";
import guard from "../../extensions/guard.ts";
import { HARNESSES } from "../harness.ts";

type Verdict = { block: boolean; reason: string } | undefined;
type Handler = (event: { toolName: string; input?: Record<string, unknown> }, ctx: { cwd: string }) => Verdict;

function handler(root?: string): (event: Parameters<Handler>[0], ctx?: { cwd: string }) => Verdict {
	let captured: Handler | undefined;
	guard(HARNESSES.pi, root, EMPTY_HOME)({ on: (_event, fn) => { captured = fn as Handler; } });
	assert.ok(captured, "the extension registered no tool_call handler");

	return (event, ctx = { cwd: process.cwd() }) => captured!(event, ctx);
}

test("the extension blocks what the policy denies and stays out of the way otherwise", () => {
	const guard = handler();

	assert.equal(guard({ toolName: "bash", input: { command: "ls -la" } }), undefined);
	assert.equal(guard({ toolName: "fleet_watch", input: { agents: "" } }), undefined);

	const denied = guard({ toolName: "bash", input: { command: "git push --force origin main" } });
	assert.equal(denied?.block, true);
	assert.match(denied?.reason ?? "", /force, delete or mirror push/);

	const unknown = guard({ toolName: "telepathy", input: { thought: "x" } });
	assert.equal(unknown?.block, true);
	assert.match(unknown?.reason ?? "", /Unknown tool policy: telepathy/);
});

test("a denied command comes back blocked with the reason the policy gave", () => {
	const guard = handler();

	const denied = guard({ toolName: "bash", input: { command: "gh pr create --title x" } });

	assert.equal(denied?.block, true);
	assert.match(denied?.reason ?? "", /push by another name/);
});

test("the extension judges a pull request by the profile of the directory the agent works in", () => {
	const guard = handler(privateRoot());
	const merge = { toolName: "bash", input: { command: "gh pr merge 12 --squash" } };

	const own = guard(merge, { cwd: checkout(`git@github.com:${PRIVATE_REPO}.git`) });
	const work = guard(merge, { cwd: checkout("git@github.com:acme/webapp.git") });

	assert.equal(own, undefined);
	assert.equal(work?.block, true);
});

test("the extension refuses a force push where the profile lets the host push on its own", () => {
	const guard = handler(privateRoot());

	const denied = guard({ toolName: "bash", input: { command: "git push -uf origin main" } }, { cwd: checkout(`git@github.com:${PRIVATE_REPO}.git`) });

	assert.match(denied?.reason ?? "", /force, delete or mirror push/);
});

test("the extension refuses an edit or a shell write of the host's permissions and lets it read them", () => {
	const root = privateRoot();
	const guard = handler(root);

	const edit = guard({ toolName: "edit", input: { path: "host/repos.json" } }, { cwd: root });
	const shell = guard({ toolName: "bash", input: { command: "sed -i s/none/auto/ host/repos.json" } }, { cwd: root });
	const read = guard({ toolName: "read", input: { path: "host/repos.json" } }, { cwd: root });
	const mine = ["edit", "write"].map((toolName) => guard({ toolName, input: { path: "~/.config/harness/repos.json" } }, { cwd: root }));

	for (const refusal of [edit, shell, ...mine]) assert.match(refusal?.reason ?? "", /only the person changes them/);
	assert.equal(read, undefined);
	assert.equal(guard({ toolName: "read", input: { path: "~/.config/harness/repos.json" } }, { cwd: root }), undefined);
});

test("pi and omp refuse an edit or a shell redirect into their own homes, and leave reads and the fleet cache alone", () => {
	const home = "/Users/me";
	for (const name of ["pi", "omp"] as const) {
		let captured: Handler | undefined;
		guard(HARNESSES[name], undefined, home)({ on: (_event, fn) => { captured = fn as Handler; } });
		const ask = (toolName: string, input: Record<string, unknown>, cwd = "/Users/me/Work/app") => captured!({ toolName, input }, { cwd });

		for (const [toolName, input, cwd] of [
			["edit", { path: "~/.pi/agent/settings.json" }],
			["write", { path: "/Users/me/.omp/skills/host/grilling/SKILL.md" }],
			["edit", { path: "settings.json" }, "/Users/me/.pi/agent"],
			["bash", { command: "echo x > ~/.pi/agent/AGENTS.md" }],
			["bash", { command: "printf y >> $HOME/.omp/agent/config.yml" }],
			["bash", { command: "cd ~/.pi/agent && echo '{}' >settings.json" }],
			["bash", { command: "sed -i s/a/b/ ~/.pi/agent/settings.json" }],
			["bash", { command: "echo x | tee ~/.omp/agent/config.yml" }],
			["bash", { command: "jq '.x=1' ~/.pi/agent/settings.json > /tmp/s && mv /tmp/s ~/.pi/agent/settings.json" }],
			["bash", { command: "cp AGENTS.md /Users/me/.omp/agent/AGENTS.md" }],
			["bash", { command: 'echo x > "$HOME"/.pi/agent/settings.json' }],
			["bash", { command: "echo x >& ~/.pi/agent/AGENTS.md" }],
			["bash", { command: "echo x &> ~/.pi/agent/AGENTS.md" }],
			["bash", { command: "echo x >| ~/.pi/agent/AGENTS.md" }],
			["bash", { command: 'bash -c "cd ~/.pi && echo x > agent/AGENTS.md"' }],
			["bash", { command: "cd -- ~/.omp && touch agent/x" }],
			["bash", { command: "echo x > ~/.PI/agent/AGENTS.md" }],
		] as [string, Record<string, unknown>, string?][])
			assert.match(ask(toolName, input, cwd)?.reason ?? "", /harness renders/, `${name} ${JSON.stringify(input)}`);

		assert.equal(ask("read", { path: "~/.pi/agent/settings.json" }), undefined, name);
		assert.equal(ask("bash", { command: "cat ~/.omp/agent/config.yml > /tmp/config.yml" }), undefined, name);
		assert.equal(ask("bash", { command: "echo x > ~/.pi/cache/note" }), undefined, name);
		assert.equal(ask("edit", { path: "src/app.ts" }), undefined, name);
		assert.equal(ask("bash", { command: "npm test > out.log 2>&1" }), undefined, name);
		assert.equal(ask("bash", { command: "rg '> ~/.pi' src" }), undefined, name);
		assert.equal(ask("bash", { command: 'git commit -m "refuse echo x > ~/.pi/agent/AGENTS.md"' }), undefined, name);
		assert.equal(ask("bash", { command: "grep -r model ~/.omp/agent" }), undefined, name);
	}
});
