import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fakeIo } from "./fake-io.ts";
import { sendReviewNotes } from "./review-notes.ts";

const NAME = "claude-app-task";
const TASK = `/home/me/.fleet/tasks/app/${NAME}`;
const PATCH = `/home/me/.fleet/cache/diff/${NAME}.patch`;
const SENT = `${PATCH}.notes.json`;
const NOTES = {
	comments: [
		{ noteId: "user:1", source: "user", filePath: "src/a.ts", hunkIndex: 0, newRange: [12, 14], body: "rename this", author: "user" },
		{ noteId: "user:2", source: "user", filePath: "src/b.ts", hunkIndex: 1, oldRange: [3, 3], body: "why\nremoved?", author: "user" },
	],
};

function containerTab(answers: Record<string, unknown> = {}) {
	return fakeIo({
		"herdr pane current": { result: { pane: { pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1" } } },
		"herdr tab list": { result: { tabs: [{ tab_id: "w1:t1", label: NAME }] } },
		"herdr agent list": { result: { agents: [{ tab_id: "w1:t1", name: NAME }] } },
		"sbx ls": { sandboxes: [{ name: NAME, status: "running", agent: "claude", workspaces: ["/w/app"] }] },
		"hunk session list --json": { sessions: [{ sessionId: "s0", inputKind: "patch", sourceLabel: "/elsewhere.patch" }, { sessionId: "s1", inputKind: "patch", sourceLabel: PATCH }] },
		"hunk session comment list s1 --type user --json": NOTES,
		...answers,
	});
}

const steers = (io: ReturnType<typeof fakeIo>) => io.calls.filter((c) => c[0] === "herdr" && c[1] === "agent" && c[2] === "prompt").map((c) => c[4]);

test("the notes shortcut lives in Herdr prefix mode", () => {
	const config = readFileSync(new URL("../../host/herdr.toml", import.meta.url), "utf8");

	const binding = config.split("[[keys.command]]").find((block) => block.includes('command = "fleet notes"'));

	assert.ok(binding);
	assert.match(binding, /key = "prefix\+m"/);
	assert.match(binding, /type = "shell"/);
});

test("the notes written in the diff pane reach the agent through a file its steer names", () => {
	const io = containerTab();

	sendReviewNotes(undefined, undefined, io);

	const written = io.files[`${TASK}/review-notes.md`];
	assert.match(written, /^- `src\/a\.ts` lines 12-14: rename this$/m);
	assert.match(written, /^- `src\/b\.ts` removed line 3: why removed\?$/m);
	assert.deepEqual(steers(io), [`Address the person's review notes in ${TASK}/review-notes.md, under its last heading.`]);
});

test("a note already sent does not go again, and an edited one does", () => {
	const io = containerTab();
	io.files[SENT] = JSON.stringify(["user:1\nrename this", "user:2\nwhy"]);

	sendReviewNotes(undefined, undefined, io);

	const written = io.files[`${TASK}/review-notes.md`];
	assert.doesNotMatch(written, /rename this/);
	assert.match(written, /why removed\?/);
});

test("with no new notes the agent is not steered", () => {
	const io = containerTab();
	io.files[SENT] = JSON.stringify(["user:1\nrename this", "user:2\nwhy\nremoved?"]);

	assert.throws(() => sendReviewNotes(undefined, undefined, io), /no new review notes/);
	assert.deepEqual(steers(io), []);
});

test("without the container's diff pane open nothing is sent", () => {
	const io = containerTab({ "hunk session list --json": { sessions: [{ sessionId: "s0", inputKind: "patch", sourceLabel: "/elsewhere.patch" }] } });

	assert.throws(() => sendReviewNotes(undefined, undefined, io), /Ctrl\+B then D/);
	assert.deepEqual(steers(io), []);
});

test("a later round lands under its own heading below the earlier ones", () => {
	const first = containerTab({ "hunk session comment list s1 --type user --json": { comments: [NOTES.comments[0]] } });
	sendReviewNotes(undefined, undefined, first);
	const second = containerTab();
	Object.assign(second.files, first.files);

	sendReviewNotes(undefined, undefined, second);

	const rounds = second.files[`${TASK}/review-notes.md`].split(/^## /m).slice(1);
	assert.equal(rounds.length, 2);
	assert.match(rounds[0], /rename this/);
	assert.doesNotMatch(rounds[1], /rename this/);
	assert.match(rounds[1], /why removed\?/);
});
