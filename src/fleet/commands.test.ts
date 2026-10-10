import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	artifacts,
	build,
	down,
	exec,
	execScript,
	fresh,
	ls,
	peek,
	resolveSandbox,
	steer,
} from "./commands.ts";
import { fakeIo } from "./fake-io.ts";
import { checkoutProbe, commitsProbe, type Sandbox } from "./status.ts";
import { agentName } from "./name.ts";
import { KINDS, type Kind, SEATS } from "../harness.ts";

const running = {
	"sbx ls --json": {
		sandboxes: [
			{ name: "pi-a", agent: "pi", status: "running", workspaces: ["/r"] },
		],
	},
	"herdr agent list": { result: { agents: [] } },
};
const task = "/home/me/.fleet/tasks/r/pi-a";
const row = (
	name: string,
	kind: Kind = KINDS.pi,
	workspaces = ["/r"],
): Sandbox => ({ name, status: "running", workspaces, kind });
const request = (at: string, cacheRead: number) =>
	JSON.stringify({
		type: "message",
		timestamp: at,
		message: {
			role: "assistant",
			model: "m",
			usage: {
				input: 10,
				output: 1,
				cacheRead,
				cacheWrite: 0,
				cost: { total: 0.01 },
			},
			content: [],
		},
	});
const sessions = {
	[`list ${task}/logs/sessions`]: ["--r--"],
	[`stat ${task}/logs/sessions/--r--`]: {
		size: 0,
		mtime: new Date(0),
		dir: true,
	},
	[`list ${task}/logs/sessions/--r--`]: [
		"2026-09-21T12-01-18-932Z_s1.jsonl",
		"subagent-artifacts",
	],
	[`stat ${task}/logs/sessions/--r--/2026-09-21T12-01-18-932Z_s1.jsonl`]: {
		size: 10,
		mtime: new Date(0),
		dir: false,
	},
	[`stat ${task}/logs/sessions/--r--/subagent-artifacts`]: {
		size: 0,
		mtime: new Date(0),
		dir: true,
	},
	[`read ${task}/logs/sessions/--r--/2026-09-21T12-01-18-932Z_s1.jsonl`]: [
		request("2026-09-21T12:02:02Z", 0),
		request("2026-09-21T12:02:16Z", 90),
	].join("\n"),
	"git log --format=%h\t%cI --since=2026-09-21T12:02:02Z web-1":
		"abc1234\t2026-09-21T12:02:10Z",
};

test("a stopped container rejects a steer without waking it", () => {
	const io = fakeIo();

	assert.throws(() => steer({ ...row("pi-a"), status: "stopped" }, "go", io), /fleet start pi-a/);

	assert.deepEqual(io.calls, []);
});

test("steer logs the prompt before sending it", () => {
	const io = fakeIo();
	steer(row("pi-webapp-web-1"), 'zrób analizę "x"', io);
	assert.equal(io.calls[0][1], "/home/me/.fleet/tasks/fleet-events.log");
	assert.match(
		io.calls[0][2],
		/w1:host steer pi-webapp-web-1 session= "zrób analizę \\"x\\""/,
	);
	assert.deepEqual(io.calls[1], [
		"herdr",
		"agent",
		"prompt",
		"pi-webapp-web-1",
		'zrób analizę "x"',
		"--wait",
		"--until",
		"working",
		"--timeout",
		"6000",
	]);
	assert.deepEqual(io.lines, ["pi-webapp-web-1: steered"]);
});

test("steer says when the image predates the harness, and still steers", () => {
	const stale = fakeIo({
		"git log -1 --format=%h": "f7e7f1a",
		"read /home/me/.fleet/cache/pi/image-stamp": "31e3d51\n",
	});
	const fresh = fakeIo({
		"git log -1 --format=%h": "f7e7f1a",
		"read /home/me/.fleet/cache/pi/image-stamp": "f7e7f1a\n",
	});

	steer(row("pi-webapp-web-1"), "go", stale, "/root");
	steer(row("pi-webapp-web-1"), "go", fresh, "/root");

	assert.match(
		stale.lines[0],
		/built from 31e3d51, and the harness is now f7e7f1a: run fleet build --pi.*pi-webapp-web-1 keeps its image until it goes down and up again/,
	);
	assert.ok(stale.calls.some((c) => c[0] === "herdr" && c[2] === "prompt"));
	assert.deepEqual(fresh.lines, ["pi-webapp-web-1: steered"]);
});

for (const harness of Object.values(KINDS)) {
	test(`${harness.name} steer --fresh starts a new session with its own command, then sends the line once idle`, async () => {
		const sandbox = `${harness.prefix}household-budget-t01-skeleton`;
		const agent = agentName(sandbox);
		const io = fakeIo(
			{
				"herdr agent list": {
					result: { agents: [{ name: agent, pane_id: "w1:p1", agent_status: "idle" }] },
				},
			},
			SEATS[harness.name],
		);
		const herdr = io.herdr;
		io.herdr = (<T>(args: string[]) => {
			if (args[1] === "prompt" && args[3] === harness.tokens["fresh.command"]) {
				io.calls.push(["herdr", ...args]);
				throw new Error("agent_prompt_stalled");
			}
			return herdr<T>(args);
		}) as typeof io.herdr;

		await fresh(row(sandbox, harness, ["/w/household-budget"]), "Deliver issues/02-api.md", io);

		assert.deepEqual(
			io.calls.filter((c) => c[2] === "prompt").map((c) => c[4]),
			[harness.tokens["fresh.command"], "Deliver issues/02-api.md"],
		);
	});

	test(`${harness.name} steer does not resend a stalled prompt`, () => {
		const agent = `${harness.prefix}webapp-web-1727`;
		const io = fakeIo(
			{
				[`herdr agent prompt ${agent}`]: new Error("agent_prompt_stalled"),
				[`herdr agent get ${agent}`]: {
					result: { agent: { agent_status: "idle" } },
				},
				[`herdr agent read ${agent}`]: "different text",
			},
			SEATS[harness.name],
		);

		assert.throws(
			() => steer(row(agent, harness), "go", io),
			(error: Error) =>
				error.message.includes(
					"agent_prompt_stalled: Prompt submission uncertain",
				) &&
				error.message.includes(`fleet peek ${agent}`) &&
				error.message.includes("do not steer again"),
		);
		assert.deepEqual(
			io.calls.filter((c) => c[0] === "herdr").map((c) => c[2]),
			["prompt"],
		);
		assert.deepEqual(io.lines, []);
	});
}

const remoteRefs =
	'sbx exec pi-a sh -c cd "$WORKSPACE_DIR" && git for-each-ref --contains abc';

const twoRepositories = {
	version: 1,
	task: "/home/me/.fleet/tasks/r/pi-a",
	repositories: [
		{
			repo: "/r",
			name: "acme/fe",
			base: "main",
			baseSha: "1".repeat(40),
			branch: "task",
			workspace: "/r",
			served: "",
		},
		{
			repo: "/api",
			name: "acme/api",
			base: "develop",
			baseSha: "2".repeat(40),
			branch: "task",
			workspace: "/tmp/fleet-repos/api",
			served: "",
		},
	],
};
const apiProbe =
	'sbx exec pi-a sh -c cd "$1" && printf "%s\\t%s\\t%s" "$(git branch --show-current)" "$(git status --porcelain | wc -l | tr -d " ")" "$(git rev-parse HEAD)" -- /tmp/fleet-repos/api';
const twoRepositoryAnswers = {
	...running,
	"read /home/me/.fleet/config/fleet/pi-a.json": JSON.stringify(twoRepositories),
	[`sbx exec pi-a sh -c ${checkoutProbe}`]: `task\t0\t${"3".repeat(40)}`,
	'sbx exec pi-a sh -c cd "$1" && printf': `task\t0\t${"3".repeat(40)}`,
	[apiProbe]: `task\t1\t${"4".repeat(40)}`,
};

test("down keeps both clones when the API has dirty or unlanded work", () => {
	const dirty = fakeIo(twoRepositoryAnswers);

	assert.throws(() => down("pi-a", {}, dirty), /acme\/api.*1 uncommitted/);
	assert.ok(!dirty.calls.some((call) => call[0] === "sbx" && call[1] === "rm"));

	const unlanded = fakeIo({
		...twoRepositoryAnswers,
		[apiProbe]: `task\t0\t${"4".repeat(40)}`,
		[`git /api merge-base --is-ancestor ${"4".repeat(40)} refs/fleet/pi-a/api/landed`]:
			new Error("exit 1"),
	});
	assert.throws(() => down("pi-a", {}, unlanded), /acme\/api.*not landed/);
	assert.ok(
		!unlanded.calls.some((call) => call[0] === "sbx" && call[1] === "rm"),
	);
});

test("down takes both clones once each head is under its landed anchor", () => {
	const io = fakeIo({ ...twoRepositoryAnswers, [apiProbe]: `task\t0\t${"4".repeat(40)}` });

	down("pi-a", {}, io);

	assert.ok(
		io.calls.some(
			(call) =>
				call.join(" ") ===
				`git /api merge-base --is-ancestor ${"4".repeat(40)} refs/fleet/pi-a/api/landed`,
		),
	);
	assert.ok(io.calls.some((call) => call[0] === "sbx" && call[1] === "rm"));
});

test("down refuses a dirty container without --force", () => {
	const io = fakeIo({ ...running, "sbx exec pi-a sh -c": "web-1\t2\tabc" });
	assert.throws(() => down("pi-a", {}, io), /2 uncommitted file\(s\) on web-1/);
	assert.ok(!io.calls.some((c) => c[1] === "rm"));
});

test("down refuses a container whose commits never reached the repo", () => {
	const io = fakeIo({
		...running,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"git cat-file -e abc^{commit}": new Error("missing"),
		[remoteRefs]: "",
	});
	assert.throws(
		() => down("pi-a", {}, io),
		/commits on web-1 that never reached \/r; run fleet land first/,
	);
	assert.ok(!io.calls.some((c) => c[1] === "rm"));
});

test("down passes a head the repo lacks once the container pushed it to its own origin", () => {
	const io = fakeIo({
		...running,
		...sessions,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"git cat-file -e abc^{commit}": new Error("missing"),
		[remoteRefs]: "refs/remotes/origin/web-1",
		"git rev-parse --verify --quiet refs/heads/web-1": new Error("exit 1"),
		"git log --format=%h\t%cI --since=2026-09-21T12:02:02Z web-1": new Error(
			"fatal: ambiguous argument 'web-1': unknown revision",
		),
	});

	down("pi-a", {}, io);

	assert.deepEqual(io.calls.at(-1), ["sbx", "rm", "-f", "pi-a"]);
});

test("down sums the task's sessions into usage.json, closes the tab, then removes", () => {
	const io = fakeIo({
		...running,
		...sessions,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"herdr agent list": {
			result: { agents: [{ pane_id: "w1:p2", tab_id: "w1:t2", name: "pi-a" }] },
		},
	});
	down("pi-a", {}, io);
	const order = io.calls.map((c) => c.slice(0, 3).join(" "));
	const at = (prefix: string) => {
		const i = order.findIndex((o) => o.startsWith(prefix));
		assert.ok(i >= 0, `${prefix} was called`);
		return i;
	};
	assert.ok(at("git /r cat-file") < at(`write ${task}/logs/usage.json`));
	assert.ok(at(`write ${task}/logs/usage.json`) < at("herdr tab close"));
	assert.ok(at("herdr tab close") < at("sbx rm -f"));
	const usage = JSON.parse(io.files[`${task}/logs/usage.json`]);
	assert.equal(usage.totals.requests, 2);
	assert.deepEqual(usage.runs[0].commits, ["abc1234"]);
	assert.ok(
		io.lines.some(
			(l) =>
				l ===
				`pi-a: usage 2 requests, 1 run(s), cache hit 82% (1 miss), 0 compaction(s), 0 model change(s), cost 0.02 -> ${task}/logs/usage.json`,
		),
		io.lines.join("\n"),
	);
	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c[1] === "cp"));
});

test("down excludes a stopped night from running time", () => {
	const io = fakeIo({
		...running,
		...sessions,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"read /home/me/.fleet/tasks/fleet-events.log": [
			"2026-09-21T12:00:00Z w1:host created pi-a session=s runtime=1",
			"2026-09-21T13:00:00Z w1:host stop pi-a session=s",
			"2026-09-22T01:00:00Z w1:host start pi-a session=s",
		].join("\n"),
	});
	io.now = () => new Date("2026-09-22T02:00:00Z");

	down("pi-a", {}, io);

	const usage = JSON.parse(io.files[`${task}/logs/usage.json`]);
	assert.equal(usage.runtime?.coverage, "complete");
	assert.equal(usage.usage_scope, "container_lifetime");
	assert.equal(usage.runtime?.elapsed_ms, 14 * 3600_000);
	assert.equal(usage.runtime?.stopped_ms, 12 * 3600_000);
	assert.equal(usage.runtime?.running_ms, 2 * 3600_000);
	assert.equal(usage.runtime?.stop_count, 1);
	assert.equal(usage.runtime?.restart_count, 1);
	assert.equal(usage.totals.requests, 2);
	assert.ok(io.lines.some((line) => line.includes("running 120m, stopped 720m")));
});

test("down keeps usage from an older container out of the new runtime", () => {
	const io = fakeIo({
		...running,
		...sessions,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"read /home/me/.fleet/tasks/fleet-events.log": [
			"2026-09-21T12:00:00Z w1:host created pi-a session=s runtime=1",
			"2026-09-21T12:30:00Z w1:host down pi-a session=s",
			"2026-09-21T13:00:00Z w1:host created pi-a session=s runtime=1",
		].join("\n"),
		[`read ${task}/logs/sessions/--r--/2026-09-21T12-01-18-932Z_s1.jsonl`]: [
			request("2026-09-21T12:02:02Z", 0),
			request("2026-09-21T13:02:02Z", 90),
			request("2026-09-21T15:02:02Z", 90),
		].join("\n"),
		[`read ${task}/logs/activity.jsonl`]: [
			JSON.stringify({ at: "2026-09-21T12:10:00Z", tool: "bash", ok: false, agent: "main" }),
			JSON.stringify({ at: "2026-09-21T13:10:00Z", tool: "read", ok: true, agent: "main" }),
			JSON.stringify({ at: "2026-09-21T15:10:00Z", tool: "read", ok: true, agent: "main" }),
		].join("\n"),
	});
	io.now = () => new Date("2026-09-21T14:00:00Z");

	down("pi-a", {}, io);

	const usage = JSON.parse(io.files[`${task}/logs/usage.json`]);
	assert.equal(usage.runtime.elapsed_ms, 3600_000);
	assert.equal(usage.totals.requests, 1);
	assert.equal(usage.totals.cost, 0.01);
	assert.equal(usage.tools.calls, 1);
	assert.equal(usage.tools.failed, 0);
});

test("down flags long tool-activity gaps without calling them stopped time", () => {
	const io = fakeIo({
		...running,
		...sessions,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"read /home/me/.fleet/tasks/fleet-events.log": "2026-09-21T12:00:00Z w1:host created pi-a session=s runtime=1",
		[`read ${task}/logs/activity.jsonl`]: [
			JSON.stringify({ at: "2026-09-21T12:10:00Z", tool: "read", ok: true, agent: "main" }),
			JSON.stringify({ at: "2026-09-21T12:20:00Z", tool: "bash", ok: true, agent: "main" }),
		].join("\n"),
	});
	io.now = () => new Date("2026-09-21T13:00:00Z");

	down("pi-a", {}, io);

	const usage = JSON.parse(io.files[`${task}/logs/usage.json`]);
	assert.equal(usage.runtime.running_ms, 3600_000);
	assert.equal(usage.runtime.stopped_ms, 0);
	assert.equal(usage.tools?.silence_threshold_ms, 20 * 60_000);
	assert.deepEqual(usage.tools?.activity_gaps, [{ from: "2026-09-21T12:20:00.000Z", to: "2026-09-21T13:00:00.000Z", running_ms: 40 * 60_000 }]);
});

test("a stopped night is not flagged as tool inactivity", () => {
	const io = fakeIo({
		...running,
		...sessions,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"read /home/me/.fleet/tasks/fleet-events.log": [
			"2026-09-21T12:00:00Z w1:host created pi-a session=s runtime=1",
			"2026-09-21T12:02:00Z w1:host stop pi-a session=s",
			"2026-09-22T00:02:00Z w1:host start pi-a session=s",
		].join("\n"),
		[`read ${task}/logs/activity.jsonl`]: [
			JSON.stringify({ at: "2026-09-21T12:01:00Z", tool: "read", ok: true, agent: "main" }),
			JSON.stringify({ at: "2026-09-22T00:03:00Z", tool: "bash", ok: true, agent: "main" }),
		].join("\n"),
	});
	io.now = () => new Date("2026-09-22T00:04:00Z");

	down("pi-a", {}, io);

	const usage = JSON.parse(io.files[`${task}/logs/usage.json`]);
	assert.deepEqual(usage.tools?.activity_gaps, []);
	assert.equal(usage.runtime.running_ms, 4 * 60_000);
});

test("down includes an unfinished stop without treating it as running", () => {
	const io = fakeIo({
		...running,
		...sessions,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"read /home/me/.fleet/tasks/fleet-events.log": [
			"2026-09-21T12:00:00Z w1:host created pi-a session=s runtime=1",
			"2026-09-21T13:00:00Z w1:host stop pi-a session=s",
		].join("\n"),
	});
	io.now = () => new Date("2026-09-22T02:00:00Z");

	down("pi-a", {}, io);

	const usage = JSON.parse(io.files[`${task}/logs/usage.json`]);
	assert.equal(usage.runtime?.stopped_ms, 13 * 3600_000);
	assert.equal(usage.runtime?.running_ms, 3600_000);
	assert.equal(usage.runtime?.restart_count, 0);
});

test("legacy runtime coverage is unknown rather than zero stopped time", () => {
	const io = fakeIo({
		...running,
		...sessions,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"read /home/me/.fleet/tasks/fleet-events.log": "2026-09-21T12:00:00Z w1:host up pi-a session=s",
	});
	io.now = () => new Date("2026-09-22T02:00:00Z");

	down("pi-a", {}, io);

	const usage = JSON.parse(io.files[`${task}/logs/usage.json`]);
	assert.equal(usage.runtime?.coverage, "partial");
	assert.equal(usage.usage_scope, "task_sessions");
	assert.equal(usage.runtime?.elapsed_ms, 14 * 3600_000);
	assert.equal(usage.runtime?.running_ms, undefined);
	assert.equal(usage.runtime?.stopped_ms, undefined);
});

test("down reports recorded tool failures without claiming task accuracy", () => {
	const io = fakeIo({
		...running,
		...sessions,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		[`read ${task}/logs/activity.jsonl`]: [
			JSON.stringify({ at: "2026-09-21T12:02:10Z", tool: "bash", ok: false, agent: "main" }),
			JSON.stringify({ at: "2026-09-21T12:02:20Z", tool: "read", ok: true, agent: "reviewer" }),
			JSON.stringify({ at: "2026-09-21T12:02:30Z", tool: "bash", ok: true, agent: "main" }),
		].join("\n"),
	});

	down("pi-a", {}, io);

	const usage = JSON.parse(io.files[`${task}/logs/usage.json`]);
	assert.deepEqual(usage.tools, { calls: 3, failed: 1, by_tool: { bash: { calls: 2, failed: 1 }, read: { calls: 1, failed: 0 } }, by_agent: { main: { calls: 2, failed: 1 }, reviewer: { calls: 1, failed: 0 } } });
	assert.equal(usage.accuracy, undefined);
	assert.equal(usage.tps, undefined);
});

test("down leaves claude's transcripts where the container wrote them", () => {
	const io = fakeIo({
		"sbx ls --json": {
			sandboxes: [
				{ name: "claude-a", agent: "claude", status: "running", workspaces: ["/r"] },
			],
		},
		"herdr agent list": { result: { agents: [] } },
		[`sbx exec claude-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
	});

	down("claude-a", {}, io);

	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c[1] === "cp"));
	assert.ok(io.calls.some((c) => c.join(" ") === "sbx rm -f claude-a"));
});

test("down says so when pi never wrote a session", () => {
	const io = fakeIo({
		...running,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
	});
	down("pi-a", {}, io);
	assert.ok(
		io.lines.some((l) => /pi-a: no session in .*pi-a\/logs\/sessions/.test(l)),
	);
	assert.ok(!io.calls.some((c) => c[0] === "write"));
	assert.ok(io.calls.some((c) => c[1] === "rm"));
});

test("down records the guest's peak, anon memory and high and oom counts beside usage.json before removing", () => {
	const io = fakeIo({
		...running,
		[`stat ${task}`]: { size: 0, mtime: new Date(0), dir: true },
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"sbx exec pi-a cat /sys/fs/cgroup/docker/memory.peak /sys/fs/cgroup/docker/memory.stat /sys/fs/cgroup/docker/memory.events":
			"4241653760\nanon 3170893824\nfile 812646400\nanon_thp 0\nlow 0\nhigh 17\nmax 3\noom 1\noom_kill 1\noom_group_kill 0\n",
	});

	down("pi-a", {}, io);

	assert.deepEqual(JSON.parse(io.files[`${task}/logs/memory.json`]), {
		peakBytes: 4241653760,
		anonBytes: 3170893824,
		high: 17,
		oom: 1,
	});
	assert.ok(
		io.lines.includes(`pi-a: memory peak 4.0 GiB -> ${task}/logs/memory.json`),
		io.lines.join("\n"),
	);
	const order = io.calls.map((c) => c.join(" "));
	assert.ok(
		order.indexOf(`write ${task}/logs/memory.json`) <
			order.indexOf("sbx rm -f pi-a"),
	);
});

test("down removes a sandbox fleet never laid a task directory for, writing nothing", () => {
	const io = fakeIo({
		...running,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"sbx exec pi-a cat": "4241653760\nanon 3170893824\nhigh 17\noom 1\n",
	});

	down("pi-a", {}, io);

	assert.ok(!io.calls.some((c) => c[0] === "write"), io.calls.join("\n"));
	assert.deepEqual(io.calls.at(-1), ["sbx", "rm", "-f", "pi-a"]);
});

test("down goes on without the guest's memory files and says so", () => {
	const io = fakeIo({
		...running,
		[`stat ${task}`]: { size: 0, mtime: new Date(0), dir: true },
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"sbx exec pi-a cat": new Error(
			"sbx exec failed (1)\ncat: /sys/fs/cgroup/docker/memory.peak: No such file or directory",
		),
	});

	down("pi-a", {}, io);

	assert.equal(io.files[`${task}/logs/memory.json`], undefined);
	assert.ok(
		io.lines.some((l) =>
			/^pi-a: no memory recorded: cat: .*memory\.peak: No such file/.test(l),
		),
		io.lines.join("\n"),
	);
	assert.deepEqual(io.calls.at(-1), ["sbx", "rm", "-f", "pi-a"]);
});

test("down records no memory when the guest prints something other than numbers", () => {
	const io = fakeIo({
		...running,
		[`stat ${task}`]: { size: 0, mtime: new Date(0), dir: true },
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"sbx exec pi-a cat": "max\n",
	});

	down("pi-a", {}, io);

	assert.equal(io.files[`${task}/logs/memory.json`], undefined);
	assert.ok(
		io.lines.includes(
			"pi-a: no memory recorded: peakBytes, anonBytes, high, oom unreadable in /sys/fs/cgroup/docker",
		),
		io.lines.join("\n"),
	);
});

test("down treats a failed secret cleanup after removal as a warning, and a failed removal as an error", () => {
	const gone = fakeIo({
		...running,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"sbx rm -f pi-a": new Error(
			"sbx rm failed (1)\nscoped secret cleanup failed: Keychain Error",
		),
	});
	let calls = 0;
	const ls = gone.sbx;
	gone.sbx = (args, opts) =>
		args[0] === "ls" && ++calls > 1
			? JSON.stringify({ sandboxes: [] })
			: ls(args, opts);
	down("pi-a", {}, gone);
	assert.ok(
		gone.lines.some((l) => /removed, but sbx reported: .*Keychain/.test(l)),
	);

	const stuck = fakeIo({
		...running,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"sbx rm -f pi-a": new Error("sbx rm failed (1)\ncontainer busy"),
	});
	assert.throws(() => down("pi-a", {}, stuck), /container busy/);
});

test("down with --force skips the dirty and unlanded refusals", () => {
	const io = fakeIo({
		...running,
		"sbx exec pi-a sh -c": "web-1\t2\tabc",
		"git cat-file -e abc^{commit}": new Error("missing"),
	});
	down("pi-a", { force: true }, io);
	assert.ok(io.calls.some((c) => c[1] === "rm"));
});

test("down names an unknown container", () => {
	assert.throws(
		() => down("pi-nope", {}, fakeIo(running)),
		/no fleet container named pi-nope/,
	);
});

test("ls joins sbx, herdr and git state", () => {
	const io = fakeIo({
		"sbx ls --json": {
			sandboxes: [
				{
					name: "pi-webapp-web-1",
					agent: "pi",
					status: "running",
					workspaces: ["/r"],
				},
				{ name: "pi-cv-x", agent: "pi", status: "stopped", workspaces: [] },
			],
		},
		[`sbx exec pi-webapp-web-1 sh -c ${checkoutProbe}`]: "web-1\t1\tabc",
		"herdr agent list": {
			result: {
				agents: [
					{ pane_id: "w1:p2", name: "pi-webapp-web-1", agent_status: "working" },
				],
			},
		},
	});
	assert.equal(
		ls(io),
		"pi-webapp-web-1  running  working  web-1  1 uncommitted\n  commits not counted: this clone has no origin/HEAD\npi-cv-x          stopped  stopped  ?",
	);
});

test("ls reads a one-entry manifest as the one-repository row it always printed", () => {
	const io = fakeIo({
		"sbx ls --json": {
			sandboxes: [
				{
					name: "pi-webapp-web-1",
					agent: "pi",
					status: "running",
					workspaces: ["/r"],
				},
			],
		},
		"read /home/me/.fleet/config/fleet/pi-webapp-web-1.json": JSON.stringify({
			version: 1,
			task: "/home/me/.fleet/tasks/r/pi-webapp-web-1",
			repositories: [
				{
					repo: "/r",
					name: "acme/webapp",
					base: "main",
					baseSha: "1".repeat(40),
					branch: "web-1",
					workspace: "/r",
					served: "",
				},
			],
		}),
		[`sbx exec pi-webapp-web-1 sh -c ${checkoutProbe}`]: "web-1\t1\tabc",
		"herdr agent list": {
			result: {
				agents: [
					{ pane_id: "w1:p2", name: "pi-webapp-web-1", agent_status: "working" },
				],
			},
		},
	});

	assert.equal(
		ls(io),
		"pi-webapp-web-1  running  working  web-1  1 uncommitted\n  commits not counted: this clone has no origin/HEAD",
	);
});

test("ls and peek report both private repositories with their own heads", () => {
	const apiWorkspace = "/tmp/fleet-repos/api";
	const manifest = {
		version: 1,
		task: "/home/me/.fleet/tasks/r/pi-a",
		repositories: [
			{
				repo: "/r",
				name: "acme/fe",
				branch: "task",
				base: "main",
				baseSha: "1".repeat(40),
				workspace: "/r",
				served: "",
			},
			{
				repo: "/api",
				name: "acme/api",
				branch: "task",
				base: "develop",
				baseSha: "2".repeat(40),
				workspace: apiWorkspace,
				served: "",
			},
		],
	};
	const io = fakeIo({
		...running,
		"read /home/me/.fleet/config/fleet/pi-a.json": JSON.stringify(manifest),
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: `task\t0\t${"3".repeat(40)}`,
		'sbx exec pi-a sh -c cd "$1" && printf': `task\t0\t${"3".repeat(40)}`,
		'sbx exec pi-a sh -c cd "$1" && printf "%s\\t%s\\t%s" "$(git branch --show-current)" "$(git status --porcelain | wc -l | tr -d " ")" "$(git rev-parse HEAD)" -- /tmp/fleet-repos/api': `task\t1\t${"4".repeat(40)}`,
	});

	const table = ls(io);
	assert.match(table, /acme\/fe.*3{40}/);
	assert.match(table, /acme\/api.*1 dirty.*4{40}/);
	assert.ok(
		io.calls.some(
			(call) => call[0] === "sbx" && call.join(" ").includes(apiWorkspace),
		),
	);
	const detail = peek("pi-a", io, 5);
	assert.match(detail, /acme\/fe task 0 dirty 3{40}/);
	assert.match(detail, /acme\/api task 1 dirty 4{40}/);
});

test("ls names the API when its checkout cannot be probed", () => {
	const io = fakeIo({
		...running,
		"read /home/me/.fleet/config/fleet/pi-a.json": JSON.stringify({
			version: 1,
			task: "/home/me/.fleet/tasks/r/pi-a",
			repositories: [
				{
					repo: "/r",
					name: "acme/fe",
					base: "main",
					baseSha: "1".repeat(40),
					branch: "task",
					workspace: "/r",
					served: "",
				},
				{
					repo: "/api",
					name: "acme/api",
					base: "develop",
					baseSha: "2".repeat(40),
					branch: "task",
					workspace: "/tmp/fleet-repos/api",
					served: "",
				},
			],
		}),
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: `task\t0\t${"3".repeat(40)}`,
	});
	const sbx = io.sbx;
	io.sbx = (args, opts) => {
		if (
			args[0] === "exec" &&
			args.at(-1) === "/tmp/fleet-repos/api" &&
			args[4]?.startsWith('cd "$1" && printf')
		)
			throw new Error("API checkout missing");
		return sbx(args, opts);
	};

	assert.match(ls(io), /pi-a\s+failed[\s\S]*acme\/api: API checkout missing/);
});

test("ls shows a running container's commits and asks GitHub nothing, even beside an old status.md", () => {
	const io = fakeIo({
		"sbx ls --json": {
			sandboxes: [
				{ name: "pi-a", agent: "pi", status: "running", workspaces: ["/r"] },
			],
		},
		"herdr agent list": {
			result: {
				agents: [{ name: "pi-a", pane_id: "w1:p1", agent_status: "idle" }],
			},
		},
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "task\t0\tabc",
		[`sbx exec pi-a sh -c ${commitsProbe}`]:
			"task\torigin/main\t2\t0\t 1 file changed, 4 insertions(+), 1 deletion(-)\tabc1234 add two",
		[`read ${task}/status.md`]: "status: blocked\nattention: owner decision\n",
		[`read ${task}/logs/activity.jsonl`]: JSON.stringify({
			at: "2026-09-16T09:30:00Z",
			tool: "bash",
			ok: true,
			agent: "main",
		}),
	});

	assert.equal(
		ls(io),
		"pi-a  running  idle     task  up 30m, silent 30m, 1 tool call, last bash\n  commits 2 since origin/main, 2 pushed, 0 unpushed, 1 file +4 -1, latest abc1234 add two",
	);
	assert.equal(io.calls.filter((c) => c[0] === "gh").length, 0);
});

test("ls prints a container whose sandbox fails as failed with its error, and lists the rest", () => {
	const io = fakeIo({
		"sbx ls --json": {
			sandboxes: [
				{ name: "pi-broken", agent: "pi", status: "running", workspaces: ["/r"] },
				{
					name: "pi-webapp-web-1",
					agent: "pi",
					status: "running",
					workspaces: ["/r"],
				},
			],
		},
		[`sbx exec pi-broken sh -c ${checkoutProbe}`]: new Error(
			`sbx exec pi-broken sh -c cd "$WORKSPACE_DIR" && printf... failed (1)\ndocker daemon failed to start inside the sandbox`,
		),
		[`sbx exec pi-webapp-web-1 sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"herdr agent list": {
			result: {
				agents: [{ pane_id: "w1:p2", name: "pi-broken", agent_status: "idle" }],
			},
		},
	});

	assert.equal(
		ls(io),
		"pi-broken        failed   idle     ?\n  docker daemon failed to start inside the sandbox\npi-webapp-web-1  running  gone     web-1\n  commits not counted: this clone has no origin/HEAD",
	);
	assert.ok(
		!io.calls.some(
			(c) =>
				c.join(" ").startsWith("sbx exec pi-broken") &&
				!c.join(" ").includes("git branch --show-current"),
		),
	);
});

test("peek shows git state and the pane tail, or says the agent is gone", () => {
	const io = fakeIo({
		...running,
		"sbx exec pi-a sh -c": " M a.ts\n---\nabc feat: x\n---\n 1 file changed",
		"herdr agent read pi-a": "❯ waiting",
	});
	const out = peek("pi-a", io, 5);
	assert.match(out, /M a\.ts/);
	assert.match(out, /=== last 5 lines\n❯ waiting/);
	const gone = fakeIo({
		...running,
		"sbx exec pi-a sh -c": "clean",
		"herdr agent read pi-a": new Error("agent_not_found"),
	});
	assert.match(
		peek("pi-a", gone, 5),
		/no herdr agent named pi-a; the tab may still be coming up/,
	);
});

test("down probes a stopped container too, so its refusals still apply", () => {
	const io = fakeIo({
		"sbx ls --json": {
			sandboxes: [
				{ name: "pi-a", agent: "pi", status: "stopped", workspaces: ["/r"] },
			],
		},
		"herdr agent list": { result: { agents: [] } },
		"sbx exec pi-a sh -c": "web-1\t1\tabc",
	});
	assert.throws(() => down("pi-a", {}, io), /1 uncommitted/);
});

test("down passes a container whose head is already in the repo", () => {
	const io = fakeIo({
		...running,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
	});
	down("pi-a", {}, io);
	assert.deepEqual(
		io.calls.find((c) => c[0] === "git"),
		["git", "/r", "cat-file", "-e", "abc^{commit}"],
	);
});

test("resolveSandbox accepts the container name or its agent name", () => {
	const io = fakeIo({
		"sbx ls --json": {
			sandboxes: [
				{
					name: "pi-webapp-frontend-ticket-123-fix-login-page",
					agent: "pi",
					status: "running",
					workspaces: [],
				},
			],
		},
	});

	assert.equal(
		resolveSandbox("pi-webapp-frontend-ticket-123-fix-login-page", io).name,
		"pi-webapp-frontend-ticket-123-fix-login-page",
	);
	assert.equal(
		resolveSandbox("pi-webapp-frontend-ticke-6ec8f90", io).name,
		"pi-webapp-frontend-ticket-123-fix-login-page",
	);
});

test("exec runs a one-argument command line through the shell, argv untouched", () => {
	assert.equal(execScript(["pwd; echo hi"]), "pwd; echo hi");
	assert.equal(execScript(["yarn test --run"]), "yarn test --run");
	assert.equal(execScript(["git"]), 'exec "$@"');
	assert.equal(execScript(["git", "status", "--short"]), 'exec "$@"');

	const io = fakeIo();
	exec("pi-a", ["pwd; whoami"], io);
	assert.deepEqual(io.calls[0].slice(0, 5), ["sbx", "exec", "pi-a", "sh", "-c"]);
	assert.ok(
		String(io.calls[0][5]).endsWith("; pwd; whoami"),
		String(io.calls[0][5]),
	);
	assert.deepEqual(io.calls[0].slice(6), ["--", "pwd; whoami"]);
});

test("artifacts shows each task's files flat and folds its folders into one line each", () => {
	const root = "/home/me/.fleet/tasks/webapp";
	const t = `${root}/pi-webapp-web-1`;
	const file = (size: number, minutesAgo: number) => ({
		size,
		mtime: new Date(Date.UTC(2026, 8, 16, 10, 0 - minutesAgo)),
		dir: false,
	});
	const dir = { size: 96, mtime: new Date(0), dir: true };
	const io = fakeIo({
		[`list ${root}`]: ["pi-webapp-web-1", "runbook", "plan.md"],
		[`stat ${root}/plan.md`]: file(2048, 5),
		[`stat ${root}/runbook`]: dir,
		[`list ${root}/runbook`]: ["run.sh", "features"],
		[`stat ${root}/runbook/run.sh`]: file(300, 900),
		[`stat ${root}/runbook/features`]: dir,
		[`list ${root}/runbook/features`]: ["rmk.md"],
		[`stat ${root}/runbook/features/rmk.md`]: file(100, 900),
		[`stat ${t}`]: dir,
		[`list ${t}`]: ["status.md", "analysis.md", "review.md", "logs", "browser"],
		[`stat ${t}/status.md`]: file(200, 1),
		[`stat ${t}/analysis.md`]: file(800, 60),
		[`stat ${t}/review.md`]: file(3000, 30),
		[`stat ${t}/logs`]: dir,
		[`list ${t}/logs`]: ["usage.json", "sessions"],
		[`stat ${t}/logs/usage.json`]: file(5000, 1),
		[`stat ${t}/logs/sessions`]: dir,
		[`list ${t}/logs/sessions`]: ["s.jsonl"],
		[`stat ${t}/logs/sessions/s.jsonl`]: file(4_000_000, 1),
		[`stat ${t}/browser`]: dir,
		[`list ${t}/browser`]: ["20260921-1505"],
		[`stat ${t}/browser/20260921-1505`]: dir,
		[`list ${t}/browser/20260921-1505`]: ["report.md", "walk.webm"],
		[`stat ${t}/browser/20260921-1505/report.md`]: file(1000, 40),
		[`stat ${t}/browser/20260921-1505/walk.webm`]: file(9_000_000, 40),
	});

	assert.deepEqual(artifacts("/w/webapp", io).split("\n"), [
		root,
		"pi-webapp-web-1/",
		"  status.md           200B  1m ago",
		"  review.md             3K  30m ago",
		"  analysis.md         800B  1h ago",
		"  browser/          2 files  8.6M",
		"  logs/             2 files  3.8M",
		"runbook/          2 files  400B",
		"plan.md               2K  5m ago",
	]);
});

test("artifacts says so when the container left nothing", () => {
	assert.match(artifacts("/w/webapp", fakeIo()), /nothing left here yet/);
});

test("build renders the container seat into a stage and hands it to the shared build script", () => {
	const io = fakeIo({
		"list /root/rules": ["core.md"],
		"read /root/rules/core.md": "# Core\n\n- be exact\n",
		"read /root/sbx/container/sandbox.md": "# Container\n\n- a fresh rule\n",
		"read /root/agents/explorer.md": "---\nname: explorer\n---\n",
		"read /root/agents/researcher.md": "---\nname: researcher\n---\n",
		"read /root/agents/reviewer.md": "---\nname: reviewer\n---\n",
		"read /root/pi/profiles/models.json": JSON.stringify({
			seats: { host: { model: "p/m", thinking: "max" } },
		}),
		"read /root/pi/profiles/sbx.json": "{}",
		"read /root/sbx/container/toolchain.Dockerfile": "RUN install node\n",
		"read /root/pi/sbx/Dockerfile": "FROM base\n{{toolchain}}\n",
		"git log -1 --format=%h": "31e3d51",
		"git status --porcelain": "",
	});
	build("/root", undefined, io);

	const [run, script, name, image, stage] =
		io.calls.find((c) => c[0] === "run") ?? [];
	assert.deepEqual(
		[run, script, name, image],
		["run", "/root/sbx/build.sh", "pi", "my-pi:v1"],
	);
	assert.match(io.files[`${stage}/home/agent/AGENTS.md`] ?? "", /a fresh rule/);
	assert.equal(io.files["/home/me/.fleet/cache/pi/image-stamp"], "31e3d51\n");
});

test("both agent Dockerfiles select Docker-capable bases and request nested Docker", () => {
	const pi = readFileSync(
		new URL("../../pi/sbx/Dockerfile", import.meta.url),
		"utf8",
	);
	const claude = readFileSync(
		new URL("../../claude/sbx/Dockerfile", import.meta.url),
		"utf8",
	);

	assert.match(pi, /^FROM docker\/sandbox-templates:shell-docker$/m);
	assert.match(claude, /^FROM docker\/sandbox-templates:claude-code-docker$/m);
	for (const dockerfile of [pi, claude])
		assert.match(
			dockerfile,
			/^LABEL com\.docker\.sandboxes\.start-docker="true"$/m,
		);
});

test("exec streams what the container prints instead of swallowing it", () => {
	const io = fakeIo({ ...running, "sbx exec pi-a": "" });
	exec("pi-a", ["ls -la .env"], io);

	assert.equal(io.sbxOpts.at(-1)?.stream, true);
});

test("a name that matches no container says so, and names what is running", () => {
	const io = fakeIo(running);

	assert.equal(resolveSandbox("pi-a", io).name, "pi-a");
	assert.throws(
		() => resolveSandbox("envtest", io),
		/no fleet container named envtest[\s\S]*pi-a/,
	);
});

test("artifacts live beside the repo name, so they read the same after the container is gone", () => {
	const root = "/home/me/.fleet/tasks/webapp";
	const io = fakeIo({
		[`stat ${root}/note.md`]: {
			size: 12,
			mtime: new Date(Date.UTC(2026, 8, 16, 10, 0)),
			dir: false,
		},
		[`list ${root}`]: ["note.md"],
	});

	assert.match(artifacts("/w/webapp", io), /tasks\/webapp[\s\S]*note\.md/);
});

test("artifacts skips a manifest it cannot read and names it, listing the rest", () => {
	const root = "/home/me/.fleet/tasks/webapp";
	const io = fakeIo({
		"list /home/me/.fleet/config/fleet": ["pi-old.json"],
		"read /home/me/.fleet/config/fleet/pi-old.json": '{"version":1,"repositories":[{"repo":"/w/webapp"}]}',
		[`stat ${root}/note.md`]: {
			size: 12,
			mtime: new Date(Date.UTC(2026, 8, 16, 10, 0)),
			dir: false,
		},
		[`list ${root}`]: ["note.md"],
	});

	const listing = artifacts("/w/webapp", io);

	assert.match(listing, /note\.md/);
	assert.match(io.lines.join("\n"), /skipped .*pi-old\.json is not a fleet repository manifest/);
});

test("exec picks up the repo's own toolchain before running anything", () => {
	const io = fakeIo(running);
	exec("pi-a", ["yarn build"], io);
	const script = String(io.calls[0][5]);

	assert.match(script, /fnm-bash-env\.sh/);
	assert.ok(script.trimEnd().endsWith("yarn build"), script);
});

test("ls prints a container whose branch the host repo has never seen", () => {
	const task = "/home/me/.fleet/tasks/r/pi-a";
	const req = (at: string) =>
		JSON.stringify({
			type: "message",
			timestamp: at,
			message: {
				role: "assistant",
				model: "m",
				usage: {
					input: 10,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					cost: { total: 0.21 },
				},
				content: [],
			},
		});
	const io = fakeIo({
		...running,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		[`list ${task}/logs/sessions`]: ["s1.jsonl"],
		[`stat ${task}/logs/sessions/s1.jsonl`]: {
			size: 10,
			mtime: new Date(0),
			dir: false,
		},
		[`read ${task}/logs/sessions/s1.jsonl`]: [
			req("2026-09-16T09:30:00Z"),
			req("2026-09-16T09:40:00Z"),
		].join("\n"),
		"git log": new Error(
			"git log --format=%h\t%cI --since=2026-09-16T09:30:00Z web-1 failed (128)\nfatal: ambiguous argument 'web-1': unknown revision or path not in the working tree.",
		),
		[`read ${task}/logs/activity.jsonl`]: [
			JSON.stringify({
				at: "2026-09-16T09:30:00Z",
				tool: "read",
				ok: true,
				agent: "main",
			}),
			JSON.stringify({
				at: "2026-09-16T09:52:00Z",
				tool: "bash",
				ok: false,
				agent: "main",
			}),
		].join("\n"),
	});

	const table = ls(io);

	assert.equal(
		table,
		"pi-a  running  gone     web-1  up 30m, silent 8m, 2 tool calls, last bash, 1 failed in a row, $0.42\n  commits not counted: this clone has no origin/HEAD",
	);
	assert.ok(!io.calls.some((c) => c[0] === "git" && c[2] === "log"));
});

test("ls prices a claude container from the transcripts it writes into its task directory", () => {
	const claudeTask = "/home/me/.fleet/tasks/r/claude-a";
	const io = fakeIo(
		{
			"sbx ls --json": {
				sandboxes: [
					{
						name: "claude-a",
						agent: "claude",
						status: "running",
						workspaces: ["/r"],
					},
				],
			},
			"herdr agent list": {
				result: {
					agents: [{ name: "claude-a", pane_id: "w1:p1", agent_status: "working" }],
				},
			},
			[`sbx exec claude-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
			[`list ${claudeTask}/logs/sessions`]: ["projects"],
			[`stat ${claudeTask}/logs/sessions/projects`]: { size: 0, mtime: new Date(0), dir: true },
			[`list ${claudeTask}/logs/sessions/projects`]: ["s1.jsonl"],
			[`stat ${claudeTask}/logs/sessions/projects/s1.jsonl`]: { size: 10, mtime: new Date(0), dir: false },
			[`read ${claudeTask}/logs/sessions/projects/s1.jsonl`]: request("2026-09-16T09:30:00Z", 0),
			[`read ${claudeTask}/logs/activity.jsonl`]: JSON.stringify({
				at: "2026-09-16T09:59:00Z",
				tool: "Edit",
				ok: true,
				agent: "main",
			}),
		},
		SEATS.claude,
	);

	assert.equal(
		ls(io),
		"claude-a  running  working  web-1  up 1m, silent 1m, 1 tool call, last Edit, $0.01\n  commits not counted: this clone has no origin/HEAD",
	);
	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c[3] === "node"));
});

test("ls still prices a stopped pi container from the sessions it wrote", () => {
	const io = fakeIo({
		"sbx ls --json": {
			sandboxes: [
				{ name: "pi-a", agent: "pi", status: "stopped", workspaces: ["/r"] },
			],
		},
		"herdr agent list": { result: { agents: [] } },
		[`list ${task}/logs/sessions`]: ["s1.jsonl"],
		[`stat ${task}/logs/sessions/s1.jsonl`]: {
			size: 10,
			mtime: new Date(0),
			dir: false,
		},
		[`read ${task}/logs/sessions/s1.jsonl`]: request("2026-09-16T09:30:00Z", 0),
	});

	assert.equal(ls(io), "pi-a  stopped  stopped  ?  $0.01");
	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c[1] === "exec"));
});

test("ls keeps a stopped two-repo sandbox asleep", () => {
	const io = fakeIo({
		"sbx ls --json": {
			sandboxes: [
				{ name: "pi-a", agent: "pi", status: "stopped", workspaces: ["/r"] },
			],
		},
		"herdr agent list": { result: { agents: [] } },
		"read /home/me/.fleet/config/fleet/pi-a.json": JSON.stringify({
			version: 1,
			task: "/home/me/.fleet/tasks/r/pi-a",
			repositories: [
				{
					repo: "/r",
					name: "acme/one",
					base: "main",
					baseSha: "1".repeat(40),
					branch: "task",
					workspace: "/r",
					served: "",
				},
				{
					repo: "/api",
					name: "acme/two",
					base: "develop",
					baseSha: "2".repeat(40),
					branch: "task",
					workspace: "/tmp/fleet-repos/api",
					served: "",
				},
			],
		}),
	});

	const table = ls(io);
	assert.match(table, /pi-a\s+stopped\s+stopped\s+\?/);
	assert.match(table, /acme\/one task \? dirty 1{40} \(last known\)/);
	assert.match(table, /acme\/two task \? dirty 2{40} \(last known\)/);
	assert.equal(io.calls.filter((c) => c[0] === "sbx" && c[1] === "exec").length, 0);
});
