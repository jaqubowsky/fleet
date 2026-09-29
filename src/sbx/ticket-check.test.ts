import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = new URL("../../sbx/container/ticket-check.sh", import.meta.url)
	.pathname;

function issues(tickets: Record<string, string>): string {
	const dir = join(mkdtempSync(join(tmpdir(), "tc-")), "issues");
	mkdirSync(dir);
	for (const [name, text] of Object.entries(tickets))
		writeFileSync(join(dir, name), text);
	return dir;
}

function ticketCheck(...args: string[]): {
	status: number | null;
	out: string;
} {
	const run = spawnSync("bash", [script, ...args], { encoding: "utf8" });
	return { status: run.status, out: run.stdout + run.stderr };
}

function checkTask(dir: string) {
	const task = join(dir, "..");
	return spawnSync("bash", [script], {
		encoding: "utf8",
		env: {
			...process.env,
			FLEET_ARTIFACTS: join(task, ".."),
			SANDBOX_NAME: task.split("/").pop(),
		},
	});
}

const done =
	"# 01: One\n\nStatus: done\n\n## Acceptance criteria\n\n- [x] it works (test a)\n";

test("a done ticket with every criterion ticked passes", () => {
	const dir = issues({ "01-one.md": done });

	assert.equal(ticketCheck(join(dir, "01-one.md")).status, 0);
});

test("a committed ticket still claimed fails and names its status", () => {
	const dir = issues({
		"02-two.md": done.replace("Status: done", "Status: claimed"),
	});

	const run = ticketCheck(join(dir, "02-two.md"));

	assert.equal(run.status, 1);
	assert.match(run.out, /02-two\.md: Status: claimed, not done/);
});

test("an unticked criterion fails and is quoted", () => {
	const dir = issues({ "03-three.md": `${done}- [ ] the second one\n` });

	const run = ticketCheck(join(dir, "03-three.md"));

	assert.equal(run.status, 1);
	assert.match(run.out, /03-three\.md: unticked: - \[ \] the second one/);
});

test("with no argument every ticket of the task directory is checked", () => {
	const dir = issues({
		"01-one.md": done,
		"02-two.md": "# 02\n\nStatus: ready-for-agent\n",
	});
	const run = checkTask(dir);

	assert.equal(run.status, 1);
	assert.match(run.stdout, /02-two\.md: Status: ready-for-agent, not done/);
	assert.doesNotMatch(run.stdout, /01-one/);
});

test("a task directory with no tickets passes", () => {
	const dir = issues({});
	const run = checkTask(dir);

	assert.equal(run.status, 0, run.stdout);
});

test("a done ticket written with CRLF passes, and a tab-indented or starred box still counts as unticked", () => {
	const dir = issues({
		"04-crlf.md": done.replaceAll("\n", "\r\n"),
		"05-boxes.md": `${done}\t- [ ] tabbed\n* [ ] starred\n`,
	});

	assert.equal(ticketCheck(join(dir, "04-crlf.md")).status, 0);
	const run = ticketCheck(join(dir, "05-boxes.md"));
	assert.match(run.out, /unticked: - \[ \] tabbed/);
	assert.match(run.out, /unticked: \* \[ \] starred/);
});

test("an unticked screen criterion is printed as missing verification", () => {
	const dir = issues({
		"06-screen.md": `${done}- [ ] The saved filter appears in the list after reopening it\n`,
	});

	const run = ticketCheck(join(dir, "06-screen.md"));

	assert.equal(run.status, 1);
	assert.match(
		run.out,
		/06-screen\.md: unticked: - \[ \] The saved filter appears in the list after reopening it/,
	);
});
