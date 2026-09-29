import assert from "node:assert/strict";
import { test } from "node:test";
import {
	artifacts,
	build,
	down,
	exec,
	execScript,
	handoff,
	history,
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
		sandboxes: [{ name: "pi-a", agent: "pi", status: "running", workspaces: ["/r"] }],
	},
	"herdr agent list": { result: { agents: [] } },
};
const task = "/home/me/.sandboxes/r/pi-a";
const row = (name: string, kind: Kind = KINDS.pi, workspaces = ["/r"]): Sandbox => ({ name, status: "running", workspaces, kind });
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

test("steer logs the prompt before sending it", () => {
	const io = fakeIo();
	steer(row("pi-webapp-web-1"), 'zrób analizę "x"', io);
	assert.equal(io.calls[0][1], "/home/me/.sandboxes/fleet-events.log");
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
	const stale = fakeIo({ "git log -1 --format=%h": "f7e7f1a", "read /home/me/.pi/cache/image-stamp": "31e3d51\n" });
	const fresh = fakeIo({ "git log -1 --format=%h": "f7e7f1a", "read /home/me/.pi/cache/image-stamp": "f7e7f1a\n" });

	steer(row("pi-webapp-web-1"), "go", stale, "/root");
	steer(row("pi-webapp-web-1"), "go", fresh, "/root");

	assert.match(stale.lines[0], /built from 31e3d51, and the harness is now f7e7f1a: run fleet build --pi.*pi-webapp-web-1 keeps its image until it goes down and up again/);
	assert.ok(stale.calls.some((c) => c[0] === "herdr" && c[2] === "prompt"));
	assert.deepEqual(fresh.lines, ["pi-webapp-web-1: steered"]);
});

for (const harness of Object.values(KINDS)) {
	test(`${harness.name} handoff takes a stalled command as steered once status.md turns to handoff complete`, async () => {
		const sandbox = `${harness.prefix}household-budget-t01-skeleton`;
		const agent = agentName(sandbox);
		const path = `/home/me/.sandboxes/household-budget/${sandbox}/status.md`;
		const command = harness.tokens["handoff.command"];
		const steerAfter = async (from: string, to: string) => {
			const io = fakeIo({}, SEATS[harness.name]);
			io.files[path] = `status: implementing\nattention: ${from}\n`;
			io.herdr = () => {
				io.files[path] = `status: implementing\nattention: ${to}\n`;
				throw new Error("agent_prompt_stalled");
			};
			await handoff(row(sandbox, harness, ["/w/household-budget"]), io);
			return io.lines;
		};
		const suggested = "session handoff suggested";
		const complete = "session handoff complete; fresh session idle";

		assert.deepEqual(await steerAfter(suggested, complete), [`${agent}: steered`]);
		await assert.rejects(steerAfter(suggested, suggested), new RegExp(`${command} sent, and status.md shows no context reset`));
		await assert.rejects(steerAfter(complete, complete), new RegExp(`${command} sent, and status.md shows no context reset`));
	});

	test(`${harness.name} handoff takes its command as steered on the context reset, not on working`, async () => {
		const sandbox = `${harness.prefix}household-budget-t01-skeleton`;
		const agent = agentName(sandbox);
		const path = `/home/me/.sandboxes/household-budget/${sandbox}/status.md`;
		const command = harness.tokens["handoff.command"];
		const suggested = "session handoff suggested";
		const steerReaching = async (to: string) => {
			const io = fakeIo({}, SEATS[harness.name]);
			io.files[path] = `status: implementing\nattention: ${suggested}\n`;
			io.herdr = (() => {
				io.files[path] = `status: implementing\nattention: ${to}\n`;
				return {};
			}) as typeof io.herdr;
			await handoff(row(sandbox, harness, ["/w/household-budget"]), io);
			return io.lines;
		};

		assert.deepEqual(await steerReaching("session handoff complete; fresh session idle"), [`${agent}: steered`]);
		await assert.rejects(steerReaching(suggested), new RegExp(`${command} sent, and status.md shows no context reset`));
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

const remoteRefs = 'sbx exec pi-a sh -c cd "$WORKSPACE_DIR" && git for-each-ref --contains abc';

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
		"git log --format=%h\t%cI --since=2026-09-21T12:02:02Z web-1": new Error("fatal: ambiguous argument 'web-1': unknown revision"),
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

test("down says so when pi never wrote a session", () => {
	const io = fakeIo({ ...running, [`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc" });
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
	assert.ok(io.lines.includes(`pi-a: memory peak 4.0 GiB -> ${task}/logs/memory.json`), io.lines.join("\n"));
	const order = io.calls.map((c) => c.join(" "));
	assert.ok(order.indexOf(`write ${task}/logs/memory.json`) < order.indexOf("sbx rm -f pi-a"));
});

test("down goes on without the guest's memory files and says so", () => {
	const io = fakeIo({
		...running,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"sbx exec pi-a cat": new Error("sbx exec failed (1)\ncat: /sys/fs/cgroup/docker/memory.peak: No such file or directory"),
	});

	down("pi-a", {}, io);

	assert.equal(io.files[`${task}/logs/memory.json`], undefined);
	assert.ok(io.lines.some((l) => /^pi-a: no memory recorded: cat: .*memory\.peak: No such file/.test(l)), io.lines.join("\n"));
	assert.deepEqual(io.calls.at(-1), ["sbx", "rm", "-f", "pi-a"]);
});

test("down records no memory when the guest prints something other than numbers", () => {
	const io = fakeIo({
		...running,
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"sbx exec pi-a cat": "max\n",
	});

	down("pi-a", {}, io);

	assert.equal(io.files[`${task}/logs/memory.json`], undefined);
	assert.ok(io.lines.includes("pi-a: no memory recorded: peakBytes, anonBytes, high, oom unreadable in /sys/fs/cgroup/docker"), io.lines.join("\n"));
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
				{ name: "pi-webapp-web-1", agent: "pi", status: "running", workspaces: ["/r"] },
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
		"pi-webapp-web-1  running  working  web-1  1 uncommitted\n  commits not counted: this clone has no origin/HEAD; pr not read: no branch\npi-cv-x           stopped  gone     ?",
	);
});

test("ls shows a running container's commits and PR, and an idle one past the threshold without a finish as stalled", () => {
	const io = fakeIo({
		"sbx ls --json": { sandboxes: [{ name: "pi-a", agent: "pi", status: "running", workspaces: ["/r"] }] },
		"herdr agent list": { result: { agents: [{ name: "pi-a", pane_id: "w1:p1", agent_status: "idle" }] } },
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "task\t0\tabc",
		[`sbx exec pi-a sh -c ${commitsProbe}`]: "task\torigin/main\t2\t0\t 1 file changed, 4 insertions(+), 1 deletion(-)\tabc1234 add two",
		"gh pr view task --json number,state,statusCheckRollup": { number: 12, state: "OPEN", statusCheckRollup: [{ __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "SUCCESS" }] },
		[`read ${task}/status.md`]: "status: implementing\nattention: none\n",
		[`read ${task}/logs/activity.jsonl`]: JSON.stringify({ at: "2026-09-16T09:30:00Z", tool: "bash", ok: true, agent: "main" }),
	});

	assert.equal(
		ls(io),
		"pi-a  running  idle     task  stalled  up 30m, silent 30m, 1 tool call, last bash\n  commits 2 since origin/main, 2 pushed, 0 unpushed, 1 file +4 -1, latest abc1234 add two; pr #12 open, CI passed",
	);
	assert.ok(io.calls.some((c) => c.join(" ") === "gh /r pr view task --json number,state,statusCheckRollup"));
});

test("ls prints a container whose sandbox fails as failed with its error, and lists the rest", () => {
	const io = fakeIo({
		"sbx ls --json": {
			sandboxes: [
				{ name: "pi-broken", agent: "pi", status: "running", workspaces: ["/r"] },
				{ name: "pi-webapp-web-1", agent: "pi", status: "running", workspaces: ["/r"] },
			],
		},
		[`sbx exec pi-broken sh -c ${checkoutProbe}`]: new Error(`sbx exec pi-broken sh -c cd "$WORKSPACE_DIR" && printf... failed (1)\ndocker daemon failed to start inside the sandbox`),
		[`sbx exec pi-webapp-web-1 sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
		"herdr agent list": { result: { agents: [{ pane_id: "w1:p2", name: "pi-broken", agent_status: "idle" }] } },
	});

	assert.equal(
		ls(io),
		"pi-broken         failed   idle     ?\n  docker daemon failed to start inside the sandbox\npi-webapp-web-1  running  gone     web-1\n  commits not counted: this clone has no origin/HEAD; pr not read: no branch",
	);
	assert.ok(!io.calls.some((c) => c.join(" ").startsWith("sbx exec pi-broken") && !c.join(" ").includes("git branch --show-current")));
});

const call = (at: string) => JSON.stringify({ at, tool: "bash", ok: true, agent: "main" });
const change = (at: string, status: string, attention: string, added: string[] = [], removed: string[] = [], summary?: string) =>
	JSON.stringify({ at, status, attention, summary, added, removed });

function blockedTask(dir: string, status = "status: blocked\nattention: owner decision\n"): Record<string, unknown> {
	return {
		[`read ${dir}/status.md`]: status,
		[`read ${dir}/logs/status.jsonl`]: [
			change("2026-09-16T09:00:00.000Z", "implementing", "none"),
			change("2026-09-16T09:30:00.400Z", "blocked", "owner decision"),
			change("2026-09-16T09:40:00.000Z", "blocked", "owner decision", ["- waits on the owner"]),
		].join("\n"),
		[`read ${dir}/logs/activity.jsonl`]: [call("2026-09-16T09:20:00Z"), call("2026-09-16T09:30:00.400Z"), call("2026-09-16T09:35:00Z"), call("2026-09-16T09:45:00Z"), call("2026-09-16T09:50:00Z")].join("\n"),
	};
}

test("ls marks a blocked container that keeps making tool calls, counted after the change where status.md turned blocked", () => {
	const listing = {
		"sbx ls --json": { sandboxes: [{ name: "pi-a", agent: "pi", status: "running", workspaces: ["/r"] }] },
		"herdr agent list": { result: { agents: [{ name: "pi-a", pane_id: "w1:p1", agent_status: "working" }] } },
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "task\t0\tabc",
	};

	assert.match(ls(fakeIo({ ...listing, ...blockedTask(task) })), /^pi-a  running  working  task  3 tool calls since blocked  up 40m, silent 10m, 5 tool calls, last bash$/m);
	assert.doesNotMatch(ls(fakeIo({ ...listing, ...blockedTask(task, "status: implementing\nattention: none\n") })), /since blocked/);
	assert.doesNotMatch(ls(fakeIo({ ...listing, ...blockedTask(task, "status: blocked\nattention: the agent stopped on an error: rate_limit\n") })), /since blocked/);
});

test("ls leaves an idle container unmarked while its PR's CI runs", () => {
	const io = fakeIo({
		"sbx ls --json": { sandboxes: [{ name: "pi-a", agent: "pi", status: "running", workspaces: ["/r"] }] },
		"herdr agent list": { result: { agents: [{ name: "pi-a", pane_id: "w1:p1", agent_status: "idle" }] } },
		[`sbx exec pi-a sh -c ${checkoutProbe}`]: "task\t0\tabc",
		[`sbx exec pi-a sh -c ${commitsProbe}`]: "task\torigin/main\t1\t0\t 1 file changed, 1 insertion(+)\tabc1234 add one",
		"gh pr view task --json number,state,statusCheckRollup": { number: 12, state: "OPEN", statusCheckRollup: [{ __typename: "CheckRun", name: "test", status: "QUEUED", conclusion: "" }] },
		[`read ${task}/status.md`]: "status: implementing\nattention: none\n",
		[`read ${task}/logs/activity.jsonl`]: JSON.stringify({ at: "2026-09-16T09:30:00Z", tool: "bash", ok: true, agent: "main" }),
	});

	assert.doesNotMatch(ls(io), /stalled/);
});

test("peek shows git state and the pane tail, or says the agent is gone", () => {
	const io = fakeIo({
		"sbx exec pi-a sh -c": " M a.ts\n---\nabc feat: x\n---\n 1 file changed",
		"herdr agent read pi-a": "❯ waiting",
	});
	const out = peek("pi-a", io, 5);
	assert.match(out, /M a\.ts/);
	assert.match(out, /=== last 5 lines\n❯ waiting/);
	const gone = fakeIo({
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
			sandboxes: [{ name: "pi-a", agent: "pi", status: "stopped", workspaces: ["/r"] }],
		},
		"herdr agent list": { result: { agents: [] } },
		"sbx exec pi-a sh -c": "web-1\t1\tabc",
	});
	assert.throws(() => down("pi-a", {}, io), /1 uncommitted/);
});

test("down passes a container whose head is already in the repo", () => {
	const io = fakeIo({ ...running, [`sbx exec pi-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc" });
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
		resolveSandbox("pi-webapp-frontend-tick-33301c6", io).name,
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
	const root = "/home/me/.sandboxes/webapp";
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
		"  status.md            200B  1m ago",
		"  review.md              3K  30m ago",
		"  analysis.md          800B  1h ago",
		"  browser/           2 files  8.6M",
		"  logs/              2 files  3.8M",
		"runbook/           2 files  400B",
		"plan.md                2K  5m ago",
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
	assert.equal(io.files["/home/me/.pi/cache/image-stamp"], "31e3d51\n");
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
	const root = "/home/me/.sandboxes/webapp";
	const io = fakeIo({
		[`stat ${root}/note.md`]: {
			size: 12,
			mtime: new Date(Date.UTC(2026, 8, 16, 10, 0)),
			dir: false,
		},
		[`list ${root}`]: ["note.md"],
	});

	assert.match(artifacts("/w/webapp", io), /sandboxes\/webapp[\s\S]*note\.md/);
});

test("exec picks up the repo's own toolchain before running anything", () => {
	const io = fakeIo(running);
	exec("pi-a", ["yarn build"], io);
	const script = String(io.calls[0][5]);

	assert.match(script, /fnm-bash-env\.sh/);
	assert.ok(script.trimEnd().endsWith("yarn build"), script);
});

test("ls prints a container whose branch the host repo has never seen", () => {
	const task = "/home/me/.sandboxes/r/pi-a";
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
			JSON.stringify({ at: "2026-09-16T09:30:00Z", tool: "read", ok: true, agent: "main" }),
			JSON.stringify({ at: "2026-09-16T09:52:00Z", tool: "bash", ok: false, agent: "main" }),
		].join("\n"),
	});

	const table = ls(io);

	assert.equal(table, "pi-a  running  gone     web-1  up 30m, silent 8m, 2 tool calls, last bash, 1 failed in a row, $0.42\n  commits not counted: this clone has no origin/HEAD; pr not read: no branch");
	assert.ok(!io.calls.some((c) => c[0] === "git" && c[2] === "log"));
});

test("ls reads a claude container's cost from its live transcripts, before down copies them out", () => {
	const io = fakeIo(
		{
			"sbx ls --json": { sandboxes: [{ name: "claude-a", agent: "claude", status: "running", workspaces: ["/r"] }] },
			"herdr agent list": { result: { agents: [{ name: "claude-a", pane_id: "w1:p1", agent_status: "working" }] } },
			[`sbx exec claude-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
			"sbx exec claude-a node /home/agent/fleet/src/fleet/usage.ts /home/agent/.claude/projects": "1.5",
			"read /home/me/.sandboxes/r/claude-a/logs/activity.jsonl": JSON.stringify({ at: "2026-09-16T09:59:00Z", tool: "Edit", ok: true, agent: "main" }),
		},
		SEATS.claude,
	);

	assert.equal(ls(io), "claude-a  running  working  web-1  up 1m, silent 1m, 1 tool call, last Edit, $1.50\n  commits not counted: this clone has no origin/HEAD; pr not read: no branch");
});

test("ls still prices a stopped pi container from the sessions it wrote", () => {
	const io = fakeIo({
		"sbx ls --json": { sandboxes: [{ name: "pi-a", agent: "pi", status: "stopped", workspaces: ["/r"] }] },
		"herdr agent list": { result: { agents: [] } },
		[`list ${task}/logs/sessions`]: ["s1.jsonl"],
		[`stat ${task}/logs/sessions/s1.jsonl`]: { size: 10, mtime: new Date(0), dir: false },
		[`read ${task}/logs/sessions/s1.jsonl`]: request("2026-09-16T09:30:00Z", 0),
	});

	assert.equal(ls(io), "pi-a  stopped  gone     ?  $0.01");
	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c[1] === "exec"));
});

test("ls keeps a claude container's activity when its image cannot price the transcripts", () => {
	const io = fakeIo(
		{
			"sbx ls --json": { sandboxes: [{ name: "claude-a", agent: "claude", status: "running", workspaces: ["/r"] }] },
			"herdr agent list": { result: { agents: [] } },
			[`sbx exec claude-a sh -c ${checkoutProbe}`]: "web-1\t0\tabc",
			"sbx exec claude-a node": new Error("sbx exec claude-a node failed (1)\nError: Cannot find module '/home/agent/fleet/src/fleet/usage.ts'"),
			"read /home/me/.sandboxes/r/claude-a/logs/activity.jsonl": JSON.stringify({ at: "2026-09-16T09:59:00Z", tool: "Edit", ok: true, agent: "main" }),
		},
		SEATS.claude,
	);

	assert.equal(ls(io), "claude-a  running  gone     web-1  up 1m, silent 1m, 1 tool call, last Edit\n  commits not counted: this clone has no origin/HEAD; pr not read: no branch");
});

test("history lists every status.md change in local time with what changed in it, the log lines it added and those it removed", (t) => {
	const zone = process.env.TZ;
	process.env.TZ = "Europe/Warsaw";
	t.after(() => {
		if (zone === undefined) delete process.env.TZ;
		else process.env.TZ = zone;
	});
	const decided = "- Decided: 55% wide, because the user chose it; analysis.md";
	const io = fakeIo({
		...running,
		[`read ${task}/logs/status.jsonl`]: [
			change("2026-09-23T20:40:13.000Z", "blocked", "choose the grid width", [], [], "WEB-1715 waits on the grid width."),
			change("2026-09-23T20:43:06.000Z", "implementing", "none", [decided]),
			change("2026-09-23T20:43:58.000Z", "ready-for-host", "none", ["- Grid committed; abc1234"], [decided], "The preview is\n55% wide."),
		].join("\n"),
	});

	const out = history("pi-a", "/somewhere/else", io);

	assert.equal(
		out,
		[
			"001  2026-09-23 22:40:13  blocked",
			"     attention: choose the grid width",
			"     summary: WEB-1715 waits on the grid width.",
			"002  2026-09-23 22:43:06  blocked -> implementing",
			"     attention: none",
			"     + Decided: 55% wide, because the user chose it; analysis.md",
			"003  2026-09-23 22:43:58  implementing -> ready-for-host",
			"     summary: The preview is 55% wide.",
			"     + Grid committed; abc1234",
			"     removed: Decided: 55% wide, because the user chose it; analysis.md",
		].join("\n"),
	);
});

test("history of a container already down reads the task directory of the repo it names", () => {
	const io = fakeIo({ "sbx ls --json": { sandboxes: [] } });

	assert.equal(
		history("pi-gone", "/w/webapp", io),
		"/home/me/.sandboxes/webapp/pi-gone/logs/status.jsonl: no changes yet; the container adds a line each time status.md changes",
	);
});
