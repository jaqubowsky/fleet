import assert from "node:assert/strict";
import { test } from "node:test";
import { artifacts, build, down, exec, execScript, history, ls, peek, resolveSandbox, steer } from "./commands.ts";
import { fakeIo } from "./fake-io.ts";

const running = { "sbx ls --json": { sandboxes: [{ name: "pi-a", status: "running", workspaces: ["/r"] }] }, "herdr agent list": { result: { agents: [] } } };
const task = "/home/me/.sandboxes/r/pi-a";
const request = (at: string, cacheRead: number) => JSON.stringify({ type: "message", timestamp: at, message: { role: "assistant", model: "m", usage: { input: 10, output: 1, cacheRead, cacheWrite: 0, cost: { total: 0.01 } }, content: [] } });
const sessions = {
	[`list ${task}/logs/sessions`]: ["--r--"],
	[`stat ${task}/logs/sessions/--r--`]: { size: 0, mtime: new Date(0), dir: true },
	[`list ${task}/logs/sessions/--r--`]: ["2026-09-21T12-01-18-932Z_s1.jsonl", "subagent-artifacts"],
	[`stat ${task}/logs/sessions/--r--/2026-09-21T12-01-18-932Z_s1.jsonl`]: { size: 10, mtime: new Date(0), dir: false },
	[`stat ${task}/logs/sessions/--r--/subagent-artifacts`]: { size: 0, mtime: new Date(0), dir: true },
	[`read ${task}/logs/sessions/--r--/2026-09-21T12-01-18-932Z_s1.jsonl`]: [request("2026-09-21T12:02:02Z", 0), request("2026-09-21T12:02:16Z", 90)].join("\n"),
	"git log --format=%h\t%cI --since=2026-09-21T12:02:02Z web-1": "abc1234\t2026-09-21T12:02:10Z",
};

test("steer logs the prompt before sending it", () => {
	const io = fakeIo();
	steer("pi-webapp-web-1", 'zrób analizę "x"', io);
	assert.equal(io.calls[0][1], "/home/me/.pi/agent/fleet-events.log");
	assert.match(io.calls[0][2], /w1:host steer pi-webapp-web-1 session= "zrób analizę \\"x\\""/);
	assert.deepEqual(io.calls[1], ["herdr", "agent", "prompt", "pi-webapp-web-1", 'zrób analizę "x"']);
	assert.deepEqual(io.lines, ["pi-webapp-web-1: steered"]);
});

test("down refuses a dirty container without --force", () => {
	const io = fakeIo({ ...running, "sbx exec pi-a sh -c": "web-1\t2\tabc" });
	assert.throws(() => down("pi-a", {}, io), /2 uncommitted file\(s\) on web-1/);
	assert.ok(!io.calls.some((c) => c[1] === "rm"));
});

test("down refuses a container whose commits never reached the repo", () => {
	const io = fakeIo({ ...running, "sbx exec pi-a sh -c": "web-1\t0\tabc", "git cat-file -e abc^{commit}": new Error("missing") });
	assert.throws(() => down("pi-a", {}, io), /commits on web-1 that never reached \/r; run fleet land first/);
	assert.ok(!io.calls.some((c) => c[1] === "rm"));
});

test("down sums the task's sessions into usage.json, closes the tab, then removes", () => {
	const io = fakeIo({ ...running, ...sessions, "sbx exec pi-a sh -c": "web-1\t0\tabc", "herdr agent list": { result: { agents: [{ pane_id: "w1:p2", tab_id: "w1:t2", name: "pi-a" }] } } });
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
	assert.ok(io.lines.some((l) => l === `pi-a: usage 2 requests, 1 run(s), cache hit 82% (1 miss), 0 compaction(s), 0 model change(s), cost 0.02 -> ${task}/logs/usage.json`), io.lines.join("\n"));
	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c[1] === "cp"));
});

test("down says so when pi never wrote a session", () => {
	const io = fakeIo({ ...running, "sbx exec pi-a sh -c": "web-1\t0\tabc" });
	down("pi-a", {}, io);
	assert.ok(io.lines.some((l) => /pi-a: no session in .*pi-a\/logs\/sessions/.test(l)));
	assert.ok(!io.calls.some((c) => c[0] === "write"));
	assert.ok(io.calls.some((c) => c[1] === "rm"));
});

test("down treats a failed secret cleanup after removal as a warning, and a failed removal as an error", () => {
	const gone = fakeIo({ ...running, "sbx exec pi-a sh -c": "web-1\t0\tabc", "sbx rm -f pi-a": new Error("sbx rm failed (1)\nscoped secret cleanup failed: Keychain Error") });
	let calls = 0;
	const ls = gone.sbx;
	gone.sbx = (args, opts) => (args[0] === "ls" && ++calls > 1 ? JSON.stringify({ sandboxes: [] }) : ls(args, opts));
	down("pi-a", {}, gone);
	assert.ok(gone.lines.some((l) => /removed, but sbx reported: .*Keychain/.test(l)));

	const stuck = fakeIo({ ...running, "sbx exec pi-a sh -c": "web-1\t0\tabc", "sbx rm -f pi-a": new Error("sbx rm failed (1)\ncontainer busy") });
	assert.throws(() => down("pi-a", {}, stuck), /container busy/);
});

test("down with --force skips the dirty and unlanded refusals", () => {
	const io = fakeIo({ ...running, "sbx exec pi-a sh -c": "web-1\t2\tabc", "git cat-file -e abc^{commit}": new Error("missing") });
	down("pi-a", { force: true }, io);
	assert.ok(io.calls.some((c) => c[1] === "rm"));
});

test("down names an unknown container", () => {
	assert.throws(() => down("pi-nope", {}, fakeIo(running)), /no fleet container named pi-nope/);
});

test("ls joins sbx, herdr and git state", () => {
	const io = fakeIo({
		"sbx ls --json": { sandboxes: [{ name: "pi-webapp-web-1", status: "running", workspaces: ["/r"] }, { name: "pi-cv-x", status: "stopped", workspaces: [] }] },
		"sbx exec pi-webapp-web-1 sh -c": "web-1\t1\tabc",
		"herdr agent list": { result: { agents: [{ pane_id: "w1:p2", name: "pi-webapp-web-1", agent_status: "working" }] } },
	});
	assert.equal(ls(io), "pi-webapp-web-1  running  working  web-1  1 uncommitted\npi-cv-x           stopped  gone     ?");
});

test("peek shows git state and the pane tail, or says the agent is gone", () => {
	const io = fakeIo({ "sbx exec pi-a sh -c": " M a.ts\n---\nabc feat: x\n---\n 1 file changed", "herdr agent read pi-a": "❯ waiting" });
	const out = peek("pi-a", io, 5);
	assert.match(out, /M a\.ts/);
	assert.match(out, /=== last 5 lines\n❯ waiting/);
	const gone = fakeIo({ "sbx exec pi-a sh -c": "clean", "herdr agent read pi-a": new Error("agent_not_found") });
	assert.match(peek("pi-a", gone, 5), /no herdr agent named pi-a; the tab may still be coming up/);
});

test("down probes a stopped container too, so its refusals still apply", () => {
	const io = fakeIo({ "sbx ls --json": { sandboxes: [{ name: "pi-a", status: "stopped", workspaces: ["/r"] }] }, "herdr agent list": { result: { agents: [] } }, "sbx exec pi-a sh -c": "web-1\t1\tabc" });
	assert.throws(() => down("pi-a", {}, io), /1 uncommitted/);
});

test("down passes a container whose head is already in the repo", () => {
	const io = fakeIo({ ...running, "sbx exec pi-a sh -c": "web-1\t0\tabc" });
	down("pi-a", {}, io);
	assert.deepEqual(io.calls.find((c) => c[0] === "git"), ["git", "/r", "cat-file", "-e", "abc^{commit}"]);
});

test("resolveSandbox accepts the container name or its agent name", () => {
	const io = fakeIo({ "sbx ls --json": { sandboxes: [{ name: "pi-webapp-frontend-ticket-123-fix-login-page", status: "running", workspaces: [] }] } });

	assert.equal(resolveSandbox("pi-webapp-frontend-ticket-123-fix-login-page", io), "pi-webapp-frontend-ticket-123-fix-login-page");
	assert.equal(resolveSandbox("pi-webapp-frontend-tick-33301c6", io), "pi-webapp-frontend-ticket-123-fix-login-page");
});

test("exec runs a one-argument command line through the shell, argv untouched", () => {
	assert.equal(execScript(["pwd; echo hi"]), "pwd; echo hi");
	assert.equal(execScript(["yarn test --run"]), "yarn test --run");
	assert.equal(execScript(["git"]), 'exec "$@"');
	assert.equal(execScript(["git", "status", "--short"]), 'exec "$@"');

	const io = fakeIo();
	exec("pi-a", ["pwd; whoami"], io);
	assert.deepEqual(io.calls[0].slice(0, 5), ["sbx", "exec", "pi-a", "sh", "-c"]);
	assert.ok(String(io.calls[0][5]).endsWith('; pwd; whoami'), String(io.calls[0][5]));
	assert.deepEqual(io.calls[0].slice(6), ["--", "pwd; whoami"]);
});

test("artifacts shows each task's files flat and folds its folders into one line each", () => {
	const root = "/home/me/.sandboxes/webapp";
	const t = `${root}/pi-webapp-web-1`;
	const file = (size: number, minutesAgo: number) => ({ size, mtime: new Date(Date.UTC(2026, 8, 16, 10, 0 - minutesAgo)), dir: false });
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
		"read /root/pi/profiles/models.json": JSON.stringify({ seats: { host: { model: "p/m", thinking: "max" } } }),
		"read /root/pi/profiles/sbx.json": "{}",
		"read /root/sbx/container/toolchain.Dockerfile": "RUN install node\n",
		"read /root/pi/sbx/Dockerfile": "FROM base\n{{toolchain}}\n",
		"git log -1 --format=%h": "31e3d51",
		"git status --porcelain": "",
	});
	build("/root", io);

	const [run, script, name, image, stage] = io.calls.find((c) => c[0] === "run") ?? [];
	assert.deepEqual([run, script, name, image], ["run", "/root/sbx/build.sh", "pi", "my-pi:v1"]);
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

	assert.equal(resolveSandbox("pi-a", io), "pi-a");
	assert.throws(() => resolveSandbox("envtest", io), /no fleet container named envtest[\s\S]*pi-a/);
});

test("artifacts live beside the repo name, so they read the same after the container is gone", () => {
	const root = "/home/me/.sandboxes/webapp";
	const io = fakeIo({
		[`stat ${root}/note.md`]: { size: 12, mtime: new Date(Date.UTC(2026, 8, 16, 10, 0)), dir: false },
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
	const req = (at: string) => JSON.stringify({ type: "message", timestamp: at, message: { role: "assistant", model: "m", usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0.21 } }, content: [] } });
	const io = fakeIo({
		...running,
		"sbx exec pi-a sh -c": "web-1\t0\tabc",
		[`list ${task}/logs/sessions`]: ["s1.jsonl"],
		[`stat ${task}/logs/sessions/s1.jsonl`]: { size: 10, mtime: new Date(0), dir: false },
		[`read ${task}/logs/sessions/s1.jsonl`]: [req("2026-09-16T09:30:00Z"), req("2026-09-16T09:40:00Z")].join("\n"),
		"git log": new Error("git log --format=%h\t%cI --since=2026-09-16T09:30:00Z web-1 failed (128)\nfatal: ambiguous argument 'web-1': unknown revision or path not in the working tree."),
	});

	const table = ls(io);

	assert.equal(table, "pi-a  running  gone     web-1  30m  $0.42");
	assert.ok(!io.calls.some((c) => c[0] === "git" && c[2] === "log"));
});

test("history lists every status.md version in local time with what changed in it and the log lines it added", (t) => {
	const zone = process.env.TZ;
	process.env.TZ = "Europe/Warsaw";
	t.after(() => {
		if (zone === undefined) delete process.env.TZ;
		else process.env.TZ = zone;
	});
	const version = (summary: string, next: string, status: string, log: string[]) =>
		`status: ${status}\nattention: none\n\n## Summary\n${summary}\n\n## Next step\n${next}\n\n## Log\n${log.map((line) => `- ${line}\n`).join("")}`;
	const io = fakeIo({
		...running,
		[`list ${task}/logs/status`]: ["003-20260923T204358Z.md", "001-20260923T204013Z.md", "002-20260923T204306Z.md"],
		[`read ${task}/logs/status/001-20260923T204013Z.md`]: version("Started WEB-1715.", "Read the ticket.", "analyzing", []),
		[`read ${task}/logs/status/002-20260923T204306Z.md`]: version("The preview is about\n55% wide.", "Read the ticket.", "analyzing", ["Baseline build passed; logs/initial-build.log"]),
		[`read ${task}/logs/status/003-20260923T204358Z.md`]: version("Analysis done.", "Change the grid.", "implementing", ["Baseline build passed; logs/initial-build.log", "Scope set; analysis.md"]),
	});

	const out = history("pi-a", "/somewhere/else", io);

	assert.equal(
		out,
		[
			"001  2026-09-23 22:40:13  analyzing",
			"     summary: Started WEB-1715.",
			"     next step: Read the ticket.",
			"002  2026-09-23 22:43:06  analyzing",
			"     summary: The preview is about 55% wide.",
			"     + Baseline build passed; logs/initial-build.log",
			"003  2026-09-23 22:43:58  analyzing -> implementing",
			"     summary: Analysis done.",
			"     next step: Change the grid.",
			"     + Scope set; analysis.md",
		].join("\n"),
	);
});

test("history of a container already down reads the task directory of the repo it names", () => {
	const io = fakeIo({ "sbx ls --json": { sandboxes: [] } });

	assert.equal(history("pi-gone", "/w/webapp", io), "/home/me/.sandboxes/webapp/pi-gone/logs/status: no versions yet; the container keeps one each time status.md changes");
});
