import assert from "node:assert/strict";
import { test } from "node:test";
import { KINDS } from "../harness.ts";
import { stopFile } from "./commands.ts";
import { fakeIo } from "./fake-io.ts";
import { keepName, stoppedScreen, stoppedView } from "./stopped.ts";

const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
const ACCENT = "\x1b[38;2;255;204;102m";
const view = { name: "claude-flowmee-flo-1781", since: new Date(2026, 9, 5, 22, 58), status: "ready-for-host", attention: "two host calls from the review" };

test("the stopped tab says what is stopped, since when, where the task stands and how to resume it", () => {
	const text = stoppedScreen(view, { columns: 120, rows: 30 }).map(plain).join("\n");

	assert.match(text, /claude-flowmee-flo-1781/);
	assert.match(text, /◉ stopped/);
	assert.match(text, /since 22:58/);
	assert.match(text, /status\s+ready-for-host/);
	assert.match(text, /attention\s+two host calls from the review/);
	assert.match(text, /fleet start claude-flowmee-flo-1781/);
});

test("only the resume command carries the accent", () => {
	const lines = stoppedScreen(view, { columns: 120, rows: 30 });

	const accented = lines.filter((line) => line.includes(ACCENT));
	assert.equal(accented.length, 1);
	assert.match(plain(accented[0]), /fleet start claude-flowmee-flo-1781/);
});

test("the panel is a rounded card in the middle of the tab, never wider than a readable column", () => {
	const lines = stoppedScreen({ ...view, attention: "y".repeat(300) }, { columns: 200, rows: 30 }).map(plain);

	const top = lines.findIndex((line) => line.includes("╭"));
	const bottom = lines.findIndex((line) => line.includes("╰"));
	assert.ok(top > 3 && bottom > top && bottom < 26, `card rows ${top}..${bottom}`);
	const left = lines[top].indexOf("╭");
	const width = lines[top].indexOf("╮") - left + 1;
	assert.ok(width <= 72, `card width ${width}`);
	assert.ok(Math.abs(left - (200 - width - left)) <= 2, `card at column ${left}`);
	assert.ok(lines.every((line) => line.length <= 200));
});

test("the card leaves the terminal's own background showing, inside and around it", () => {
	const lines = stoppedScreen(view, { columns: 120, rows: 30 });

	assert.ok(lines.every((line) => !line.includes("\x1b[48;")));
	assert.equal(plain(lines[2]).trim(), "");
});

test("a task with no attention leaves the line out", () => {
	const text = stoppedScreen({ ...view, attention: "none" }, { columns: 120, rows: 30 }).map(plain).join("\n");

	assert.doesNotMatch(text, /attention/);
});

test("the view reads the task's status.md and the time of the stop", () => {
	const sandbox = { name: "claude-webapp-a", kind: KINDS.claude, status: "stopped", workspaces: ["/w/webapp"] };
	const stoppedAt = new Date(2026, 9, 5, 21, 7);
	const io = fakeIo({ [`stat ${stopFile(sandbox, fakeIo())}`]: { size: 1, mtime: stoppedAt, dir: false } });
	io.files["/home/me/.fleet/tasks/webapp/claude-webapp-a/status.md"] = "status: implementing\nattention: none\n";

	assert.deepEqual(stoppedView(sandbox, io), { name: "claude-webapp-a", since: stoppedAt, status: "implementing", attention: "none" });
});

test("the stopped view gives its tab the container's name back whenever herdr has cleared it", () => {
	const cleared = fakeIo({ "herdr agent get w1:p7": { result: { agent: { pane_id: "w1:p7" } } } });
	const named = fakeIo({ "herdr agent get w1:p7": { result: { agent: { pane_id: "w1:p7", name: "claude-webapp-a" } } } });
	const early = fakeIo({ "herdr agent get w1:p7": new Error("agent target w1:p7 not found") });

	keepName("w1:p7", "claude-webapp-a", cleared);
	keepName("w1:p7", "claude-webapp-a", named);
	keepName("w1:p7", "claude-webapp-a", early);

	assert.deepEqual(cleared.calls.at(-1), ["herdr", "agent", "rename", "w1:p7", "claude-webapp-a"]);
	assert.equal(named.calls.filter((c) => c[2] === "rename").length, 0);
	assert.equal(early.calls.filter((c) => c[2] === "rename").length, 0);
});
