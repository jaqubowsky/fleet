import assert from "node:assert/strict";
import { test } from "node:test";
import { artifacts, build, down, exec, execScript, ls, peek, resolveSandbox, say } from "./commands.ts";
import { fakeIo } from "./fake-io.ts";

const running = { "sbx ls --json": { sandboxes: [{ name: "pi-a", status: "running", workspaces: ["/r"] }] }, "herdr agent list": { result: { agents: [] } } };

test("say logs the prompt before sending it", () => {
	const io = fakeIo();
	say("pi-webapp-web-1", 'zrób analizę "x"', io);
	assert.equal(io.calls[0][0], "append");
	assert.match(io.calls[0][2], /webapp-web-1 "zrób analizę \\"x\\""/);
	assert.deepEqual(io.calls[1], ["herdr", "agent", "prompt", "webapp-web-1", 'zrób analizę "x"']);
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

test("down harvests, closes the tab, then removes", () => {
	const io = fakeIo({ ...running, "sbx exec pi-a sh -c": "web-1\t0\tabc", "herdr agent list": { result: { agents: [{ pane_id: "w1:p2", tab_id: "w1:t2", name: "a" }] } } });
	down("pi-a", {}, io);
	const order = io.calls.map((c) => c.slice(0, 3).join(" "));
	const at = (prefix: string) => {
		const i = order.findIndex((o) => o.startsWith(prefix));
		assert.ok(i >= 0, `${prefix} was called`);
		return i;
	};
	assert.ok(at("git /r cat-file") < at("mkdir /home/me/.pi/sandbox-transcripts"));
	assert.ok(at("mkdir /home/me/.pi/sandbox-transcripts") < at("sbx cp pi-a:/home/agent/.pi/agent/sessions"));
	assert.ok(at("sbx cp pi-a:/home/agent/.pi/agent/sessions") < at("herdr tab close"));
	assert.ok(at("herdr tab close") < at("sbx rm -f"));
	assert.ok(io.calls.some((c) => c[0] === "sbx" && c[1] === "cp" && c[3].startsWith("/home/me/.pi/sandbox-transcripts/pi-a-2026")));
});

test("down continues when the container holds no transcripts", () => {
	const io = fakeIo({ ...running, "sbx exec pi-a sh -c": "web-1\t0\tabc", "sbx cp pi-a:": new Error('ERROR: path "/home/agent/.pi/agent/sessions" not found in container') });
	down("pi-a", {}, io);
	assert.ok(io.lines.some((l) => /no transcripts/.test(l)));
	assert.ok(io.calls.some((c) => c[1] === "rm"));
});

test("down treats a failed secret cleanup after removal as a warning, and a failed removal as an error", () => {
	const gone = fakeIo({ ...running, "sbx exec pi-a sh -c": "web-1\t0\tabc", "sbx cp pi-a:": new Error("not found"), "sbx rm -f pi-a": new Error("sbx rm failed (1)\nscoped secret cleanup failed: Keychain Error") });
	let calls = 0;
	const ls = gone.sbx;
	gone.sbx = (args, opts) => (args[0] === "ls" && ++calls > 1 ? JSON.stringify({ sandboxes: [] }) : ls(args, opts));
	down("pi-a", {}, gone);
	assert.ok(gone.lines.some((l) => /removed, but sbx reported: .*Keychain/.test(l)));

	const stuck = fakeIo({ ...running, "sbx exec pi-a sh -c": "web-1\t0\tabc", "sbx cp pi-a:": new Error("not found"), "sbx rm -f pi-a": new Error("sbx rm failed (1)\ncontainer busy") });
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
		"herdr agent list": { result: { agents: [{ pane_id: "w1:p2", name: "webapp-web-1", agent_status: "working" }] } },
	});
	assert.equal(ls(io), "pi-webapp-web-1  running  working  web-1  1 uncommitted\npi-cv-x           stopped  gone     ?");
});

test("peek shows git state and the pane tail, or says the agent is gone", () => {
	const io = fakeIo({ "sbx exec pi-a sh -c": " M a.ts\n---\nabc feat: x\n---\n 1 file changed", "herdr agent read a": "❯ waiting" });
	const out = peek("pi-a", io, 5);
	assert.match(out, /M a\.ts/);
	assert.match(out, /=== last 5 lines\n❯ waiting/);
	const gone = fakeIo({ "sbx exec pi-a sh -c": "clean", "herdr agent read a": new Error("agent_not_found") });
	assert.match(peek("pi-a", gone, 5), /no herdr agent named a; the tab may still be coming up/);
});

test("down probes a stopped container too, so its refusals still apply", () => {
	const io = fakeIo({ "sbx ls --json": { sandboxes: [{ name: "pi-a", status: "stopped", workspaces: ["/r"] }] }, "herdr agent list": { result: { agents: [] } }, "sbx exec pi-a sh -c": "web-1\t1\tabc" });
	assert.throws(() => down("pi-a", {}, io), /1 uncommitted/);
});

test("down passes a container whose head is already in the repo, and rethrows a real harvest failure", () => {
	const io = fakeIo({ ...running, "sbx exec pi-a sh -c": "web-1\t0\tabc" });
	down("pi-a", {}, io);
	assert.deepEqual(io.calls.find((c) => c[0] === "git"), ["git", "/r", "cat-file", "-e", "abc^{commit}"]);

	const broken = fakeIo({ ...running, "sbx exec pi-a sh -c": "web-1\t0\tabc", "sbx cp pi-a:": new Error("sbx cp failed (1)\ndaemon unreachable") });
	assert.throws(() => down("pi-a", {}, broken), /daemon unreachable/);
	assert.ok(!broken.calls.some((c) => c[1] === "rm"));
});

test("resolveSandbox accepts the container name or its agent name", () => {
	const io = fakeIo({ "sbx ls --json": { sandboxes: [{ name: "pi-webapp-web-1636", status: "running", workspaces: [] }] } });

	assert.equal(resolveSandbox("pi-webapp-web-1636", io), "pi-webapp-web-1636");
	assert.equal(resolveSandbox("webapp-web-1636", io), "pi-webapp-web-1636");
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

test("artifacts lists every file containers on the repo left, newest first, under the folder holding them", () => {
	const root = "/home/me/.sandboxes/webapp";
	const io = fakeIo({
		[`stat ${root}/shots/new-v4.png`]: { size: 400_000, mtime: new Date(Date.UTC(2026, 8, 16, 9, 30)), dir: false },
		[`stat ${root}/review-log.md`]: { size: 2048, mtime: new Date(Date.UTC(2026, 8, 16, 9, 55)), dir: false },
		[`stat ${root}/shots`]: { size: 96, mtime: new Date(Date.UTC(2026, 8, 16, 9, 30)), dir: true },
		[`list ${root}/shots`]: ["new-v4.png"],
		[`list ${root}`]: ["shots", "review-log.md"],
	});

	const out = artifacts("/w/webapp", io).split("\n");

	assert.equal(out[0], root);
	assert.match(out[1], /^review-log\.md\s+2K\s+5m ago$/);
	assert.match(out[2], /^shots\/new-v4\.png\s+391K\s+30m ago$/);
});

test("artifacts says so when the container left nothing", () => {
	assert.match(artifacts("/w/webapp", fakeIo()), /nothing left here yet/);
});

test("build renders the current rules before it bakes them into the image", () => {
	const io = fakeIo({
		"list /root/rules": ["core.md"],
		"read /root/rules/core.md": "# Core\n\n- be exact\n",
		"read /root/sbx/container/sandbox.md": "# Container\n\n- a fresh rule\n",
		"read /root/profiles/models.json": JSON.stringify({ activeProvider: "p", providers: { p: { coordinator: "m" } } }),
		"read /root/profiles/host.json": "{}",
		"read /root/profiles/sbx.json": "{}",
	});
	build("/root", io);

	assert.match(io.files["/root/sbx/AGENTS.md"] ?? "", /a fresh rule/);
	assert.deepEqual(io.calls.at(-1), ["run", "/root/sbx/build.sh"]);
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
