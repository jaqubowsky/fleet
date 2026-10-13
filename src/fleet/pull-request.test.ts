import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fakeIo } from "./fake-io.ts";
import { openPullRequest } from "./pull-request.ts";

const NAME = "claude-app-task";
const NOTED = `/home/me/.fleet/tasks/app/${NAME}/logs/pull-request.json`;

function containerTab(files: Record<string, string> = {}) {
	const io = fakeIo({
		"herdr pane current": { result: { pane: { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1" } } },
		"herdr tab list": { result: { tabs: [{ tab_id: "w1:t1", label: NAME }] } },
		"herdr agent list": { result: { agents: [{ tab_id: "w1:t1", name: NAME }] } },
		"sbx ls": { sandboxes: [{ name: NAME, status: "running", agent: "claude", workspaces: ["/w/app"] }] },
	});
	Object.assign(io.files, files);
	return io;
}

const opened = (io: ReturnType<typeof fakeIo>) => io.calls.filter((c) => c[0] === "run" && c[1] === "open");

test("the pull request shortcut lives in Herdr prefix mode", () => {
	const config = readFileSync(new URL("../../host/herdr.toml", import.meta.url), "utf8");

	const binding = config.split("[[keys.command]]").find((block) => block.includes('command = "fleet pr"'));

	assert.ok(binding);
	assert.match(binding, /key = "prefix\+u"/);
	assert.match(binding, /type = "shell"/);
});

test("the shortcut opens the pull request the tab's container opened", () => {
	const io = containerTab({ [NOTED]: JSON.stringify({ number: 2390, url: "https://github.com/acme/app/pull/2390" }) });

	openPullRequest(undefined, undefined, io);

	assert.deepEqual(opened(io), [["run", "open", "https://github.com/acme/app/pull/2390"]]);
});

test("a container that opened no pull request opens nothing and says so", () => {
	const io = containerTab();

	assert.throws(() => openPullRequest(undefined, undefined, io), /claude-app-task has opened no pull request/);
	assert.deepEqual(opened(io), []);
});

test("only a GitHub pull request address from the container reaches open", () => {
	for (const url of ["https://example.com/acme/app/pull/1", "-a Calculator", "https://github.com/acme/app/pull/1 --args", "file:///etc/passwd"]) {
		const io = containerTab({ [NOTED]: JSON.stringify({ number: 1, url }) });

		assert.throws(() => openPullRequest(undefined, undefined, io), /has opened no pull request/);
		assert.deepEqual(opened(io), []);
	}
});
