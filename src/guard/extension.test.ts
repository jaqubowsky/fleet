import assert from "node:assert/strict";
import { test } from "node:test";
import { PRIVATE_REPO } from "../profile/fixture.ts";
import { checkout, privateRoot } from "./checkouts.ts";
import guard from "../../extensions/guard.ts";
import { HARNESSES } from "../harness.ts";

type Verdict = { block: boolean; reason: string } | undefined;
type Handler = (event: { toolName: string; input?: Record<string, unknown> }, ctx: { cwd: string }) => Verdict;

function handler(root?: string): (event: Parameters<Handler>[0], ctx?: { cwd: string }) => Verdict {
	let captured: Handler | undefined;
	guard(HARNESSES.pi, root)({ on: (_event, fn) => { captured = fn as Handler; } });
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

test("the extension refuses an edit or a shell write of the host's permissions and lets it read them", () => {
	const root = privateRoot();
	const guard = handler(root);

	const edit = guard({ toolName: "edit", input: { path: "host/repos.json" } }, { cwd: root });
	const shell = guard({ toolName: "bash", input: { command: "sed -i s/none/auto/ host/repos.json" } }, { cwd: root });
	const read = guard({ toolName: "read", input: { path: "host/repos.json" } }, { cwd: root });

	assert.match(edit?.reason ?? "", /only the person changes it/);
	assert.match(shell?.reason ?? "", /only the person changes it/);
	assert.equal(read, undefined);
});
