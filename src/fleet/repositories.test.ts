import assert from "node:assert/strict";
import { test } from "node:test";
import { artifacts, down, history, ls, peek } from "./commands.ts";
import { fakeIo } from "./fake-io.ts";
import { taskDir } from "./repositories.ts";

const task = "/home/me/.fleet/tasks/groups/a-b-c/pi-a";
const manifest = {
	version: 1,
	task,
	repositories: ["a", "b", "c"].map((name) => ({
		repo: `/${name}`,
		name: `owner/${name}`,
		base: "main",
		baseSha: "1".repeat(40),
		branch: "task",
		workspace: `/${name}`,
		served: "",
	})),
};
const path = "/home/me/.fleet/config/fleet/pi-a.json";
const answers = {
	[`read ${path}`]: JSON.stringify(manifest),
	"sbx ls --json": {
		sandboxes: [
			{ name: "pi-a", agent: "pi", status: "stopped", workspaces: ["/a"] },
		],
	},
	"herdr agent list": { result: { agents: [] } },
	"list /home/me/.fleet/config/fleet": ["pi-a.json"],
	[`stat ${task}/status.md`]: { size: 10, dir: false, mtime: new Date(0) },
	[`list ${task}`]: ["status.md"],
	"list /home/me/.fleet/tasks/groups/a-b-c": ["pi-a"],
	[`stat ${task}`]: { size: 0, dir: true, mtime: new Date(0) },
};

test("three repository snapshots, peek and history use the recorded task directory", () => {
	const io = fakeIo({ ...answers, [`read ${task}/logs/status.jsonl`]: "" });
	const sbx = io.sbx;
	io.sbx = (args, opts) => {
		const result = sbx(args, opts);
		if (args[4]?.startsWith('cd "$1" && printf'))
			return `task\t0\t${String("abc".indexOf(args.at(-1)!.slice(1)) + 2).repeat(40)}`;
		return result;
	};

	const table = ls(io);
	const detail = peek("pi-a", io);
	history("pi-a", "/c", io);

	assert.equal(taskDir("/c", "pi-a", io), task);
	for (const [index, name] of ["a", "b", "c"].entries()) {
		assert.match(
			table,
			new RegExp(`owner/${name} task 0 dirty ${String(index + 2).repeat(40)}`),
		);
		assert.match(detail, new RegExp(`owner/${name}`));
	}
	assert.ok(io.calls.some((call) => call[0] === "sbx" && call.includes("/c")));
});

test("ls reads PR and CI state for every repository", () => {
	const io = fakeIo({
		...answers,
		"sbx ls --json": {
			sandboxes: [
				{ name: "pi-a", agent: "pi", status: "running", workspaces: ["/a"] },
			],
		},
	});
	const sbx = io.sbx;
	io.sbx = (args, opts) => {
		const result = sbx(args, opts);
		if (args[4]?.includes("git rev-list")) return "task\torigin/main\t0\t0\t\t";
		return result;
	};
	const queried: string[] = [];
	io.gh = (_args, repo) => {
		queried.push(repo);
		return JSON.stringify({
			number: 7,
			state: "OPEN",
			statusCheckRollup: [
				{
					name: "test",
					status: repo === "/c" ? "IN_PROGRESS" : "COMPLETED",
					conclusion: "SUCCESS",
				},
			],
		});
	};

	const printed = ls(io);

	assert.deepEqual(queried, ["/a", "/b", "/c"]);
	assert.match(printed, /CI running/);
});

test("artifacts are discoverable through every repository in a group", () => {
	for (const name of ["a", "b", "c"]) {
		const io = fakeIo(answers);

		const printed = artifacts(`/${name}`, io);

		assert.ok(printed.includes(task));
		assert.match(printed, /status\.md/);
	}
});

test("down protects the third repository's dirty work", () => {
	const io = fakeIo(answers);
	const sbx = io.sbx;
	io.sbx = (args, opts) => {
		const result = sbx(args, opts);
		if (args[4]?.startsWith('cd "$1" && printf')) {
			const index = "abc".indexOf(args.at(-1)!.slice(1));
			return `task\t${index === 2 ? 1 : 0}\t${String(index + 2).repeat(40)}`;
		}
		return result;
	};

	assert.throws(() => down("pi-a", {}, io), /owner\/c: 1 uncommitted/);
	assert.ok(!io.calls.some((call) => call[0] === "sbx" && call[1] === "rm"));
});

test("a recorded task cannot be reused for a different repository set", () => {
	const io = fakeIo(answers);

	assert.throws(
		() => taskDir("/a", "pi-a", io, ["/b", "/other"]),
		/pi-a.*different repositories/,
	);
});

test("a one-repository up cannot take over a label a group task recorded", () => {
	const io = fakeIo(answers);

	assert.throws(() => taskDir("/a", "pi-a", io, []), /pi-a.*different repositories/);
});

test("a manifest without its task directory is refused rather than guessed", () => {
	const io = fakeIo({
		[`read ${path}`]: JSON.stringify({
			version: 1,
			repositories: manifest.repositories.slice(0, 2),
		}),
	});

	assert.throws(() => taskDir("/c", "pi-a", io), /pi-a\.json is not a fleet repository manifest/);
});
