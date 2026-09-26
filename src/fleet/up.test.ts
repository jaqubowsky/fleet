import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { fakeIo } from "./fake-io.ts";
import { HARNESSES } from "../harness.ts";
import { SWITCH_TO_BRANCH, cacheDir, cacheStore, envFiles, up } from "./up.ts";
import { PRIVATE_PROFILE, PRIVATE_REPO, REAL_PROFILES, WITH_PRIVATE } from "../profile/fixture.ts";

const repo = "/Users/me/Work/webapp";
const containerLocks = 'sbx exec pi-webapp-web-1 sh -c cd "$WORKSPACE_DIR" && git ls-files';
const base = {
	"read /root/host/repos.json": REAL_PROFILES,
	"read /home/me/.config/sbx/credentials.yaml": "bindings:\n  openai:\n    oauth:\n",
	"git remote get-url origin": "git@github.com:acme/webapp.git",
	"git rev-parse --abbrev-ref origin/HEAD": "origin/main",
	"sbx ls --json": { sandboxes: [] },
	"herdr agent list": { result: { agents: [] } },
	"herdr workspace list": {
		result: { workspaces: [{ workspace_id: "w1", label: "webapp" }] },
	},
	"herdr tab list": { result: { tabs: [] } },
	"herdr tab create": { result: { root_pane: { pane_id: "w1:p9" } } },
	"herdr agent get w1:p9": {
		result: { agent: { pane_id: "w1:p9", agent_status: "idle" } },
	},
	"sbx exec pi-webapp-web-1 sh -c stty": "-icanon -icrnl",
	"sbx exec pi-cv-x sh -c stty": "-icanon -icrnl",
};

test("up creates the container, switches the branch, starts the install in the background, opens a tab and sends no prompt", async () => {
	const io = fakeIo({
		...base,
		[containerLocks]: "yarn.lock",
	});
	const out = await up(
		{ repo, label: "web-1", root: "/root", branch: "web-1" },
		io,
	);
	assert.deepEqual(out, {
		sandbox: "pi-webapp-web-1",
		agent: "pi-webapp-web-1",
		pane: "w1:p9",
	});
	const run = io.calls.find((c) => c[0] === "sbx" && c[1] === "run")!;
	assert.ok(
		run.includes("--clone") &&
			run.includes("--static-mcp") &&
			!run.some((a) => /memory_mib/.test(a)),
	);
	assert.equal(run[run.indexOf("--memory") + 1], "12g");
	assert.ok(io.calls.some((c) => c[0] === "sbx" && c[1] === "secret"));
	assert.ok(
		io.calls.some(
			(c) =>
				c[0] === "append" &&
				c[1] === "/home/me/.pi/agent/fleet-events.log" &&
				/ up pi-webapp-web-1 session=$/.test(c[2]),
		),
	);
	const execs = io.calls.filter((c) => c[0] === "sbx" && c[1] === "exec");
	assert.deepEqual(execs[0], [
		"sbx",
		"exec",
		"pi-webapp-web-1",
		"sh",
		"-c",
		SWITCH_TO_BRANCH,
		"--",
		"web-1",
		"main",
	]);
	assert.match(
		execs[2][5],
		/^setsid nohup bash -c "\$1" >\/tmp\/fleet-install\.log/,
	);
	assert.match(execs[2][7], /yarn install --frozen-lockfile/);
	assert.ok(
		io.lines.some((l) => /1 lockfile\(s\) install in the background/.test(l)),
	);
	assert.deepEqual(
		io.calls.find((c) => c[1] === "pane"),
		[
			"herdr",
			"pane",
			"run",
			"w1:p9",
			"HERDR_AGENT=pi /root/bin/fleet relay pi-webapp-web-1 /home/me/.sandboxes/webapp/pi-webapp-web-1 -- --approve --no-autoformat --no-lens-context",
		],
	);
	assert.ok(!io.calls.some((c) => c[1] === "agent" && c[2] === "prompt"));
	assert.deepEqual(io.calls.at(-1), [
		"herdr",
		"agent",
		"rename",
		"w1:p9",
		"pi-webapp-web-1",
	]);
});

test("up waits for the container tty to leave canonical input mode", async () => {
	const io = fakeIo(base);
	const sbx = io.sbx;
	let probes = 0;
	io.sbx = (args, opts) => {
		if (args[0] === "exec" && args[4]?.startsWith("stty")) {
			probes++;
			return probes === 1 ? "icanon icrnl" : "-icanon -icrnl";
		}
		return sbx(args, opts);
	};

	await up({ repo, label: "web-1", root: "/root" }, io);

	assert.equal(probes, 2);
	assert.deepEqual(io.calls.at(-1), [
		"herdr",
		"agent",
		"rename",
		"w1:p9",
		"pi-webapp-web-1",
	]);
});

for (const harness of [HARNESSES.claude, HARNESSES.omp]) {
	test(`up waits for the ${harness.agent} process even when herdr already reports a status`, async () => {
		const io = fakeIo(base, harness);
		const sbx = io.sbx;
		let probes = 0;
		io.sbx = (args, opts) => {
			if (args[0] === "exec" && args[2] === "pgrep") {
				probes++;
				assert.deepEqual(args.slice(2), ["pgrep", "-x", harness.agent]);
				if (probes === 1) throw new Error("exit status 1");
				return "42";
			}
			return sbx(args, opts);
		};

		await up({ repo, label: "web-1", root: "/root" }, io);

		assert.equal(probes, 2);
		assert.deepEqual(io.calls.at(-1), ["herdr", "agent", "rename", "w1:p9", `${harness.agent}-webapp-web-1`]);
	});

	test(`up fails with the probe's error when the ${harness.agent} process never starts`, async () => {
		const io = fakeIo({ ...base, [`sbx exec ${harness.agent}-webapp-web-1 pgrep`]: new Error("pgrep exit status 1") }, harness);

		await assert.rejects(up({ repo, label: "web-1", root: "/root" }, io), /did not become ready.*process probe: Error: pgrep exit status 1/);
	});
}

test("up warns and continues when the GitHub token cannot be bound", async () => {
	const io = fakeIo({
		...base,
		"sbx secret set github": new Error("op read: exit status 1"),
	});
	await up({ repo, label: "web-1", root: "/root" }, io);
	assert.ok(io.calls.some((c) => c[0] === "sbx" && c[1] === "run"));
	assert.ok(io.lines.some((l) => /no GitHub token bound/.test(l)));
});

test("up removes the container when setup fails", async () => {
	const io = fakeIo({
		...base,
		"sbx exec pi-webapp-web-1 sh -c cd": new Error("git switch failed"),
	});
	await assert.rejects(
		up({ repo, label: "web-1", root: "/root", branch: "web-1" }, io),
		/setup failed and the container was removed[\s\S]*git switch failed/,
	);
	assert.deepEqual(io.calls.at(-1), ["sbx", "rm", "-f", "pi-webapp-web-1"]);
	assert.ok(!io.calls.some((c) => c[1] === "pane"));
});

test("up copies every submodule and its git metadata into the clone, then drops host node_modules", async () => {
	const io = fakeIo({
		...base,
		"git submodule status": " 1495ab0 packages/pdf-generator (v1)\n",
		"sbx exec pi-webapp-web-1 sh -c printf": repo,
		[containerLocks]: "yarn.lock",
	});
	await up({ repo, label: "web-1", root: "/root" }, io);
	const cps = io.calls
		.filter((c) => c[0] === "sbx" && c[1] === "cp")
		.map((c) => c.slice(2));
	assert.deepEqual(cps, [
		[`${repo}/packages/pdf-generator`, `pi-webapp-web-1:${repo}/packages/`],
		[
			`${repo}/.git/modules/packages/pdf-generator`,
			`pi-webapp-web-1:${repo}/.git/modules/packages/`,
		],
		[
			"/home/me/.pi/agent/extensions/herdr-agent-state.ts",
			"pi-webapp-web-1:/home/agent/.pi/agent/extensions/herdr-agent-state.ts",
		],
	]);
	const chown = io.calls.find(
		(c) => c[0] === "sbx" && String(c[5]).startsWith("sudo chown"),
	)!;
	assert.match(chown[5], /rm -rf "\$1\/node_modules"/);
	assert.deepEqual(chown.slice(6), [
		"--",
		`${repo}/packages/pdf-generator`,
		`${repo}/.git/modules/packages/pdf-generator`,
	]);
	const order = io.calls.map(
		(c) => c.slice(0, 2).join(" ") + String(c[5] ?? "").slice(0, 6),
	);
	assert.ok(
		order.findIndex((o) => o.startsWith("sbx cp")) <
			order.findIndex((o) => o === "sbx execsetsid"),
	);
});

test("up without --branch never switches branches, and resolves the repo to its top level", async () => {
	const io = fakeIo({ ...base, "git rev-parse --show-toplevel": repo });
	const out = await up(
		{ repo: `${repo}/apps/web`, label: "web-1", root: "/root" },
		io,
	);
	assert.equal(out.sandbox, "pi-webapp-web-1");
	assert.ok(
		!io.calls.some(
			(c) =>
				c[0] === "sbx" && c[1] === "exec" && String(c[5]).includes("git switch"),
		),
	);
	assert.ok(
		io.calls.some((c) => c[0] === "sbx" && c[1] === "run" && c.includes(repo)),
	);
});

test("up refuses to adopt a same-named agent that is not pi", async () => {
	const io = fakeIo({
		...base,
		"herdr agent list": {
			result: {
				agents: [
					{
						pane_id: "w1:p3",
						name: "pi-webapp-web-1",
						agent: "claude",
						agent_status: "idle",
					},
				],
			},
		},
	});
	await assert.rejects(
		up({ repo, label: "web-1", root: "/root" }, io),
		/is claude in pane w1:p3, not pi/,
	);
});

test("up refuses a name another agent holds before it creates anything", async () => {
	const held = fakeIo({
		...base,
		"herdr agent list": {
			result: {
				agents: [
					{
						pane_id: "w1:p3",
						name: "pi-webapp-web-1",
						agent: "claude",
						agent_status: "idle",
					},
				],
			},
		},
	});
	const tab = fakeIo({
		...base,
		"herdr tab list": {
			result: { tabs: [{ tab_id: "w1:t7", label: "pi-webapp-web-1" }] },
		},
		"herdr pane list": {
			result: { panes: [{ pane_id: "w1:p7", tab_id: "w1:t7", agent: "omp" }] },
		},
	});
	const created = (io: typeof held) =>
		io.calls.filter(
			(c) =>
				c[0] === "mkdir" ||
				c[0] === "write" ||
				(c[0] === "sbx" && c[1] !== "ls") ||
				(c[0] === "herdr" && ["create", "rename", "run"].includes(c[2])),
		);

	await assert.rejects(
		up({ repo, label: "web-1", root: "/root" }, held),
		/is claude in pane w1:p3, not pi/,
	);
	await assert.rejects(
		up({ repo, label: "web-1", root: "/root" }, tab),
		/already runs omp/,
	);

	assert.deepEqual(created(held), []);
	assert.deepEqual(created(tab), []);
});

test("up reuses an existing container and only opens the tab", async () => {
	const io = fakeIo({
		...base,
		"sbx ls --json": {
			sandboxes: [{ name: "pi-webapp-web-1", status: "stopped", workspaces: [] }],
		},
	});
	await up({ repo, label: "web-1", root: "/root" }, io);
	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c[1] === "run"));
	assert.ok(io.calls.some((c) => c[1] === "pane"));
});

test("up adopts an agent that already carries the name, whatever its tab is called", async () => {
	const io = fakeIo({
		...base,
		"herdr agent list": {
			result: {
				agents: [
					{
						pane_id: "w1:p3",
						name: "pi-webapp-web-1",
						agent: "pi",
						agent_status: "working",
					},
				],
			},
		},
		"herdr agent get w1:p3": { result: { agent: { agent_status: "working" } } },
	});
	const out = await up({ repo, label: "web-1", root: "/root" }, io);
	assert.equal(out.pane, "w1:p3");
	assert.ok(
		!io.calls.some(
			(c) => c[1] === "pane" || (c[1] === "tab" && c[2] === "create"),
		),
	);
});

test("up reuses an empty tab with the same label, adopts an unnamed pi there, refuses another agent", async () => {
	const tabs = {
		result: { tabs: [{ tab_id: "w1:t7", label: "pi-webapp-web-1" }] },
	};
	const free = fakeIo({
		...base,
		"herdr tab list": tabs,
		"herdr pane list": {
			result: { panes: [{ pane_id: "w1:p7", tab_id: "w1:t7", agent: null }] },
		},
		"herdr agent get w1:p7": { result: { agent: { agent_status: "idle" } } },
	});
	assert.equal(
		(await up({ repo, label: "web-1", root: "/root" }, free)).pane,
		"w1:p7",
	);
	assert.ok(!free.calls.some((c) => c[1] === "tab" && c[2] === "create"));
	const adopt = fakeIo({
		...base,
		"herdr tab list": tabs,
		"herdr pane list": {
			result: { panes: [{ pane_id: "w1:p7", tab_id: "w1:t7", agent: "pi" }] },
		},
		"herdr agent get w1:p7": { result: { agent: { agent_status: "idle" } } },
	});
	await up({ repo, label: "web-1", root: "/root" }, adopt);
	assert.ok(!adopt.calls.some((c) => c[1] === "pane" && c[2] === "run"));
	assert.deepEqual(adopt.calls.at(-1), [
		"herdr",
		"agent",
		"rename",
		"w1:p7",
		"pi-webapp-web-1",
	]);
	const busy = fakeIo({
		...base,
		"herdr tab list": tabs,
		"herdr pane list": {
			result: { panes: [{ pane_id: "w1:p7", tab_id: "w1:t7", agent: "claude" }] },
		},
	});
	await assert.rejects(
		up({ repo, label: "web-1", root: "/root" }, busy),
		/already runs claude/,
	);
});

test("up creates the workspace when the repo has none and names its root tab", async () => {
	const io = fakeIo({
		...base,
		"herdr workspace list": { result: { workspaces: [] } },
		"herdr workspace create": {
			result: {
				workspace: { workspace_id: "w2" },
				root_pane: { pane_id: "w2:p1" },
			},
		},
		"herdr agent get w2:p1": { result: { agent: { agent_status: "done" } } },
	});
	const out = await up({ repo: "/r/cv", label: "x", root: "/root" }, io);
	assert.equal(out.pane, "w2:p1");
	assert.equal(out.sandbox, "pi-cv-x");
	assert.ok(
		io.calls.some(
			(c) =>
				c[1] === "tab" &&
				c[2] === "rename" &&
				c[3] === "w2:t1" &&
				c[4] === "pi-cv-x",
		),
	);
});

test("up accepts a pi that comes up blocked or working, and fails when nothing comes up", async () => {
	const blocked = fakeIo({
		...base,
		"herdr agent get w1:p9": { result: { agent: { agent_status: "blocked" } } },
	});
	await up({ repo, label: "web-1", root: "/root" }, blocked);
	const io = fakeIo({
		...base,
		"herdr agent get w1:p9": new Error("agent_not_found"),
	});
	await assert.rejects(
		up({ repo, label: "web-1", root: "/root" }, io),
		/did not become ready/,
	);
	const unknown = fakeIo({
		...base,
		"herdr agent get w1:p9": { result: { agent: { agent_status: "unknown" } } },
	});
	await assert.rejects(
		up({ repo, label: "web-1", root: "/root" }, unknown),
		/did not become ready/,
	);
});

test("up refuses a directory that is not a repository", async () => {
	const io = fakeIo({
		...base,
		"git rev-parse --show-toplevel": new Error("not a git repository"),
	});
	await assert.rejects(
		up({ repo: "/tmp", label: "x", root: "/root" }, io),
		/not a git repository/,
	);
});

test("up mounts an artifacts and a cache directory and names both in the environment", async () => {
	const io = fakeIo(base);
	await up({ repo, label: "web-1", root: "/root" }, io);
	const run = io.calls.find((c) => c[0] === "sbx" && c[1] === "run")!;

	assert.ok(
		run.includes("-e") &&
			run.includes("FLEET_ARTIFACTS=/home/me/.sandboxes/webapp"),
	);
	assert.ok(run.includes("FLEET_CACHE=/home/me/.pi/cache/webapp"));
	assert.deepEqual(run.slice(-8), [
		repo,
		"/home/me/.sandboxes/webapp",
		"/home/me/.pi/cache/webapp",
		"/home/me/my-knowledge-base:ro",
		"--",
		"--approve",
		"--no-autoformat",
		"--no-lens-context",
	]);
	assert.ok(
		io.calls.some(
			(c) => c[0] === "mkdir" && c[1] === "/home/me/.sandboxes/webapp",
		),
	);
	assert.ok(
		io.calls.some(
			(c) => c[0] === "mkdir" && c[1] === "/home/me/.pi/cache/webapp",
		),
	);
});

test("up hands the copied env files to the container user, whoever owned them on the host", async () => {
	const io = fakeIo({
		...base,
		"git ls-files --others --ignored": "apps/api/.env\n.env.docker\n",
		'sbx exec pi-webapp-web-1 sh -c printf %s "$WORKSPACE_DIR"': "/w",
	});
	await up({ repo, label: "web-1", root: "/root" }, io);

	const chown = io.calls.find((c) => c[0] === "sbx" && c.some((a) => a.includes("chown")))!;
	assert.deepEqual(chown.slice(-3), ["/w", "apps/api/.env", ".env.docker"]);
	const copies = io.calls.filter((c) => c[0] === "sbx" && c[1] === "cp" && c[2].includes(".env"));
	assert.ok(io.calls.indexOf(chown) > io.calls.indexOf(copies[copies.length - 1]));
});

test("up copies the env files the repo ignores, and skips the probe when there are none", async () => {
	const withEnv = fakeIo({
		...base,
		"git ls-files --others --ignored": "apps/api/.env\n.env.docker\n",
		'sbx exec pi-webapp-web-1 sh -c printf %s "$WORKSPACE_DIR"': "/w",
	});
	await up({ repo, label: "web-1", root: "/root" }, withEnv);

	assert.ok(
		withEnv.calls.some(
			(c) =>
				c[0] === "sbx" &&
				c[1] === "cp" &&
				c[2] === `${repo}/apps/api/.env` &&
				c[3] === "pi-webapp-web-1:/w/apps/api/.env",
		),
	);
	assert.ok(withEnv.lines.some((l) => /copied 2 ignored env file/.test(l)));

	const none = fakeIo(base);
	await up({ repo, label: "web-1", root: "/root" }, none);
	assert.deepEqual(
		none.calls.filter((c) => c[0] === "sbx" && c[1] === "cp").map((c) => c[2]),
		["/home/me/.pi/agent/extensions/herdr-agent-state.ts"],
	);
});

test("env listing takes files at any depth and never a collapsed ignored directory", () => {
	assert.deepEqual(envFiles("apps/api/.env\n\n.env.docker\n"), [
		"apps/api/.env",
		".env.docker",
	]);
	assert.deepEqual(
		envFiles(".claude/worktrees/agent-a618/\napps/estate/.env.local\n"),
		["apps/estate/.env.local"],
	);
	assert.deepEqual(envFiles(""), []);
});

test("a repository without a lockfile starts no install and says so", async () => {
	const io = fakeIo(base);
	await up({ repo, label: "web-1", root: "/root" }, io);

	assert.ok(
		!io.calls.some(
			(c) =>
				c[0] === "sbx" && c[3] === "sh" && String(c[5]).includes("fleet-install"),
		),
	);
	assert.ok(io.lines.some((l) => /no lockfile/.test(l)));
});

test("the install follows the lockfiles of the container's tree, not the host checkout's", async () => {
	const io = fakeIo({
		...base,
		"git ls-files -- :(glob)**/yarn.lock": "",
		[containerLocks]: "yarn.lock",
	});
	await up({ repo, label: "web-1", root: "/root", branch: "web-1" }, io);

	const switched = io.calls.findIndex((c) => c[5] === SWITCH_TO_BRANCH);
	const listed = io.calls.findIndex((c) => c[0] === "sbx" && String(c[5]).includes("git ls-files"));
	assert.ok(switched >= 0 && listed > switched, "lockfiles listed before the branch switch");
	assert.ok(io.calls.some((c) => c[0] === "sbx" && String(c[5]).includes("fleet-install")));
});

test("a lockfile only the host checkout holds starts no install", async () => {
	const io = fakeIo({
		...base,
		"git ls-files -- :(glob)**/yarn.lock": "yarn.lock",
		[containerLocks]: "",
	});
	await up({ repo, label: "web-1", root: "/root" }, io);

	assert.ok(!io.calls.some((c) => c[0] === "sbx" && String(c[5]).includes("fleet-install")));
	assert.ok(io.lines.some((l) => /no lockfile/.test(l)));
});

test("a lockfile listing that fails in the container removes it", async () => {
	const io = fakeIo({ ...base, [containerLocks]: new Error("exec failed") });
	await assert.rejects(
		up({ repo, label: "web-1", root: "/root" }, io),
		/setup failed and the container was removed[\s\S]*exec failed/,
	);
	assert.deepEqual(io.calls.at(-1), ["sbx", "rm", "-f", "pi-webapp-web-1"]);
});

test("a seeded submodule is registered so the clone sees it as a submodule", async () => {
	const io = fakeIo({
		...base,
		"git submodule status": " 1495ab0 packages/pdf-generator (v1)\n",
		"sbx exec pi-webapp-web-1 sh -c printf": repo,
	});
	await up({ repo, label: "web-1", root: "/root" }, io);

	const registered = io.calls.find(
		(c) => c[0] === "sbx" && String(c[5] ?? "").includes("gitdir:"),
	)!;
	assert.ok(registered, "the submodule was never registered");
	assert.deepEqual(registered.slice(6), [
		"--",
		"../../.git/modules/packages/pdf-generator",
		`${repo}/packages/pdf-generator/.git`,
	]);
});

test("a seeded submodule is registered in the clone, not left as untracked work", async () => {
	const io = fakeIo({
		...base,
		"git submodule status": " 1495ab0 packages/pdf-generator (v1)\n",
		"sbx exec pi-webapp-web-1 sh -c printf": repo,
		[containerLocks]: "yarn.lock",
	});
	await up({ repo, label: "web-1", root: "/root" }, io);
	const execs = io.calls
		.filter((c) => c[0] === "sbx" && c[1] === "exec")
		.map((c) => String(c[5]));

	assert.ok(
		execs.some((s) => s.includes("gitdir:")),
		"no .git file written",
	);
	assert.ok(
		execs.some((s) => s.includes("git submodule init")),
		"the submodule was never registered",
	);
});

for (const harness of Object.values(HARNESSES)) {
	test(`the ${harness.agent} container keeps its npm cache in the repository's shared cache`, async () => {
		const io = fakeIo(base, harness);
		await up({ repo, label: "web-1", root: "/root" }, io);
		const run = io.calls.find((c) => c[0] === "sbx" && c[1] === "run")!;

		assert.ok(run.includes(`npm_config_cache=${cacheDir(repo, io)}/npm`));
		assert.ok(run.includes(cacheDir(repo, io)));
	});
}

test("the build cache is linked by the fleet, not by whoever reads the rules", async () => {
	const io = fakeIo({
		...base,
		"sbx exec pi-webapp-web-1 sh -c printf": repo,
		"read /Users/me/Work/webapp/turbo.json": "{}",
	});
	await up({ repo, label: "web-1", root: "/root" }, io);
	const run = io.calls.find((c) => c[0] === "sbx" && c[1] === "run")!;

	assert.ok(
		run.includes("CI=true"),
		"the container does not announce itself as a non-interactive environment",
	);
	assert.deepEqual(
		run.slice(run.indexOf("--cpus"), run.indexOf("--cpus") + 2),
		["--cpus", "4"],
		"the container was not given a core budget",
	);
	assert.ok(
		!run.some((a) => String(a).startsWith("YARN_CACHE_FOLDER")),
		"the yarn cache was put on the shared mount",
	);
	assert.equal(io.files["/home/me/.pi/cache/webapp/paths"], ".turbo/cache\n");
	const link = io.calls.find(
		(c) => c[0] === "sbx" && String(c[5] ?? "").includes("ln -sfn"),
	)!;
	assert.deepEqual(link.slice(6), [
		"--",
		"/home/me/.pi/cache/webapp/.turbo-cache",
		`${repo}/.turbo/cache`,
	]);
});

test("a cache path keeps one store whether or not it was written with a leading dot-slash", () => {
	assert.equal(cacheStore(".turbo/cache"), ".turbo-cache");
	assert.equal(cacheStore("./.turbo/cache"), ".turbo-cache");
	assert.equal(cacheStore("apps/web/.turbo/cache"), "apps-web-.turbo-cache");
});

test("up lays out the task directory once and points pi's sessions into it", async () => {
	const io = fakeIo(base);
	await up({ repo, label: "web-1", root: "/root", branch: "web-1" }, io);
	const task = "/home/me/.sandboxes/webapp/pi-webapp-web-1";

	assert.ok(
		io.calls.some((c) => c[0] === "mkdir" && c[1] === `${task}/logs/sessions`),
	);
	assert.equal(io.files[`${task}/task.md`], undefined);
	assert.equal(
		io.files[`${task}/status.md`],
		"status: new\nattention: none\n\n## Summary\nNo progress or verification has been recorded yet.\n\n## Next step\nFollow the assigned task and record the first progress update.\n\n## Log\n",
	);
	const run = io.calls.find((c) => c[0] === "sbx" && c[1] === "run")!;
	assert.ok(run.includes(`PI_CODING_AGENT_SESSION_DIR=${task}/logs/sessions`));

	const again = fakeIo({
		...base,
		[`read ${task}/status.md`]: "status: implementing",
	});
	await up({ repo, label: "web-1", root: "/root" }, again);
	assert.deepEqual(again.calls.filter((c) => c[0] === "write").map((c) => c[1]), [`${task}/permissions.md`]);
});

test("up hands --model to pi and resumes the last session when one is on disk", async () => {
	const task = "/home/me/.sandboxes/webapp/pi-webapp-web-1";
	const fresh = fakeIo(base);
	await up(
		{
			repo,
			label: "web-1",
			root: "/root",
			model: "openai-codex/gpt-5.6-luna:high",
		},
		fresh,
	);
	assert.equal(
		fresh.calls.find((c) => c[1] === "pane")![4],
		"HERDR_AGENT=pi /root/bin/fleet relay pi-webapp-web-1 /home/me/.sandboxes/webapp/pi-webapp-web-1 -- --approve --no-autoformat --no-lens-context --model openai-codex/gpt-5.6-luna:high",
	);

	const resumed = fakeIo({
		...base,
		[`list ${task}/logs/sessions`]: ["--Users-me-Work-webapp--"],
	});
	await up({ repo, label: "web-1", root: "/root" }, resumed);
	assert.equal(
		resumed.calls.find((c) => c[1] === "pane")![4],
		"HERDR_AGENT=pi /root/bin/fleet relay pi-webapp-web-1 /home/me/.sandboxes/webapp/pi-webapp-web-1 -- --approve --no-autoformat --no-lens-context -c",
	);
});

test("up branches off the freshest remote base, detected or given with --base", async () => {
	const detected = fakeIo(base);
	await up({ repo, label: "web-1", root: "/root", branch: "web-1" }, detected);
	const script = detected.calls.find(
		(c) => c[0] === "sbx" && c[1] === "exec" && c[5] === SWITCH_TO_BRANCH,
	)!;
	assert.deepEqual(script.slice(6), ["--", "web-1", "main"]);

	const given = fakeIo(base);
	await up(
		{ repo, label: "web-1", root: "/root", branch: "web-1", base: "develop" },
		given,
	);
	assert.deepEqual(
		given.calls
			.find((c) => c[0] === "sbx" && c[1] === "exec" && c[5] === SWITCH_TO_BRANCH)!
			.slice(6),
		["--", "web-1", "develop"],
	);
});

function originWithClone(t: TestContext): { origin: string; seed: string; workspace: string; git: (dir: string, ...args: string[]) => string } {
	const root = mkdtempSync(join(tmpdir(), "up-branch-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const git = (dir: string, ...args: string[]) =>
		execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();
	const origin = join(root, "origin.git");
	const seed = join(root, "seed");
	const workspace = join(root, "workspace");
	execFileSync("git", ["init", "--quiet", "--bare", "-b", "main", origin]);
	execFileSync("git", ["clone", "--quiet", origin, seed], { stdio: "ignore" });
	git(seed, "commit", "--quiet", "--allow-empty", "-m", "base");
	git(seed, "push", "--quiet", "origin", "main");
	execFileSync("git", ["clone", "--quiet", origin, workspace], { stdio: "ignore" });
	return { origin, seed, workspace, git };
}

const branchScript = (workspace: string, branch: string) =>
	execFileSync("sh", ["-c", SWITCH_TO_BRANCH, "--", branch, "main"], {
		env: { ...process.env, WORKSPACE_DIR: workspace },
		encoding: "utf8",
	}).trim();

const pushTicket = (seed: string, git: (dir: string, ...args: string[]) => string) => {
	git(seed, "switch", "--quiet", "-c", "ticket/04");
	git(seed, "commit", "--quiet", "--allow-empty", "-m", "ticket work");
	git(seed, "push", "--quiet", "origin", "ticket/04");
};

test("up --branch picks up a branch that exists only on origin and says so", (t) => {
	const { seed, workspace, git } = originWithClone(t);
	pushTicket(seed, git);

	const out = branchScript(workspace, "ticket/04");

	assert.equal(git(workspace, "rev-parse", "HEAD"), git(seed, "rev-parse", "HEAD"));
	assert.match(out, /^ticket\/04 continues the existing branch origin\/ticket\/04$/m);
});

test("up --branch takes origin's branch over a stale local one", (t) => {
	const { seed, workspace, git } = originWithClone(t);
	git(workspace, "branch", "ticket/04");
	pushTicket(seed, git);

	branchScript(workspace, "ticket/04");

	assert.equal(git(workspace, "rev-parse", "HEAD"), git(seed, "rev-parse", "HEAD"));
});

test("up --branch keeps a branch only the clone holds", (t) => {
	const { workspace, git } = originWithClone(t);
	git(workspace, "switch", "--quiet", "-c", "local-work");
	git(workspace, "commit", "--quiet", "--allow-empty", "-m", "unpushed");
	const unpushed = git(workspace, "rev-parse", "HEAD");
	git(workspace, "switch", "--quiet", "main");

	const out = branchScript(workspace, "local-work");

	assert.equal(git(workspace, "rev-parse", "HEAD"), unpushed);
	assert.match(out, /^local-work continues the local branch local-work$/m);
});

test("up --branch starts a branch origin lacks from origin's base and says so", (t) => {
	const { seed, workspace, git } = originWithClone(t);

	const out = branchScript(workspace, "ticket/05");

	assert.equal(git(workspace, "rev-parse", "HEAD"), git(seed, "rev-parse", "main"));
	assert.equal(git(workspace, "branch", "--show-current"), "ticket/05");
	assert.match(out, /^ticket\/05 is new from origin\/main$/m);
});

test("up --branch says so when origin could not be asked for the branch", (t) => {
	const { origin, workspace } = originWithClone(t);
	rmSync(origin, { recursive: true, force: true });

	const out = branchScript(workspace, "ticket/05");

	assert.match(out, /^fetch of ticket\/05 failed, so a branch origin holds starts from the base$/m);
});

test("up logs which start the branch took", async () => {
	const io = fakeIo({
		...base,
		[`sbx exec pi-webapp-web-1 sh -c ${SWITCH_TO_BRANCH}`]: "web-1 continues the existing branch origin/web-1",
	});

	await up({ repo, label: "web-1", root: "/root", branch: "web-1" }, io);

	assert.ok(io.lines.includes("pi-webapp-web-1: web-1 continues the existing branch origin/web-1"));
});

test("a claude container is given colour, a pi container is left as it is", async () => {
	const claudeIo = fakeIo(base, HARNESSES.claude);
	const piIo = fakeIo(base);

	await up({ repo, label: "web-1", root: "/root", branch: "web-1" }, claudeIo);
	await up({ repo, label: "web-1", root: "/root", branch: "web-1" }, piIo);

	const args = (io: typeof piIo) =>
		io.calls.find((c) => c[0] === "sbx" && c[1] === "run")!;
	const claude = args(claudeIo);
	assert.equal(
		claude[claude.indexOf("FORCE_COLOR=3") - 1],
		"-e",
		"FORCE_COLOR is passed as its own -e",
	);
	assert.ok(!args(piIo).includes("FORCE_COLOR=3"));
});

for (const [h, integration, command] of [
	[
		HARNESSES.pi,
		".pi/agent/extensions/herdr-agent-state.ts",
		"HERDR_AGENT=pi /root/bin/fleet relay pi-webapp-web-1 /home/me/.sandboxes/webapp/pi-webapp-web-1 -- --approve --no-autoformat --no-lens-context",
	],
	[
		HARNESSES.omp,
		".omp/agent/extensions/herdr-omp-agent-state.ts",
		"HERDR_AGENT=omp /root/bin/ofleet relay omp-webapp-web-1 /home/me/.sandboxes/webapp/omp-webapp-web-1 -- --yolo",
	],
] as const) {
	test(`up copies herdr's ${h.name} integration into a new container and starts ${h.name} through the relay`, async () => {
		const io = fakeIo(base, h);

		await up({ repo, label: "web-1", root: "/root" }, io);

		assert.ok(
			io.calls.some(
				(c) =>
					c.join(" ") ===
					`sbx cp /home/me/${integration} ${h.prefix}webapp-web-1:/home/agent/${integration}`,
			),
		);
		assert.equal(io.calls.find((c) => c[1] === "pane")![4], command);
	});
}

test("cfleet up starts claude straight through sbx run and copies no herdr integration", async () => {
	const io = fakeIo(base, HARNESSES.claude);

	await up({ repo, label: "web-1", root: "/root" }, io);

	assert.equal(
		io.calls.find((c) => c[1] === "pane")![4],
		"HERDR_AGENT=claude sbx run --name claude-webapp-web-1",
	);
	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c[1] === "cp"));
});

test("cfleet up empties the CLAUDE.md sbx writes beside the workspace, and fleet up leaves pi alone", async () => {
	const claude = fakeIo(base, HARNESSES.claude);
	const pi = fakeIo(base);

	await up({ repo, label: "web-1", root: "/root" }, claude);
	await up({ repo, label: "web-1", root: "/root" }, pi);

	const emptied = (io: typeof pi) => io.calls.find((c) => c[0] === "sbx" && c.some((a) => a.includes("truncate -s 0")));
	assert.equal(emptied(claude)?.at(-1), "CLAUDE.md");
	assert.equal(emptied(pi), undefined);
});

test("up stops before creating anything when no sbx binding lets openai in, unless the model comes from elsewhere", async () => {
	const unbound = { ...base, "read /home/me/.config/sbx/credentials.yaml": "bindings: {}\n" };
	const io = fakeIo(unbound);
	const openrouter = fakeIo(unbound);

	await assert.rejects(up({ repo, label: "web-1", root: "/root" }, io), /no sbx binding lets openai in/);
	await up({ repo, label: "web-1", root: "/root", model: "openrouter/moonshotai/kimi-k2.6:high" }, openrouter);

	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c[1] === "run"));
	assert.ok(openrouter.calls.some((c) => c[0] === "sbx" && c[1] === "run"));
});

test("cfleet up stops when claude in the new container is not logged in", async () => {
	const io = fakeIo({ ...base, "herdr agent read w1:p9 --source visible": "Not logged in · Run /login" }, HARNESSES.claude);

	await assert.rejects(up({ repo, label: "web-1", root: "/root" }, io), /claude is not logged in.*\/login in tab claude-webapp-web-1/);
});

test("up says when the image predates the harness it would carry", async () => {
	const stale = fakeIo({
		...base,
		"git log -1 --format=%h": "f7e7f1a",
		"read /home/me/.pi/cache/image-stamp": "31e3d51\n",
	});
	const fresh = fakeIo({
		...base,
		"git log -1 --format=%h": "f7e7f1a",
		"read /home/me/.pi/cache/image-stamp": "f7e7f1a\n",
	});

	await up({ repo, label: "web-1", root: "/root" }, stale);
	await up({ repo, label: "web-1", root: "/root" }, fresh);

	assert.ok(
		stale.lines.some((line) =>
			/built from 31e3d51, and the harness is now f7e7f1a: run fleet build/.test(
				line,
			),
		),
		stale.lines.join("\n"),
	);
	assert.ok(!fresh.lines.some((line) => /built from/.test(line)));
});

test("up binds the token, Linear server and resources of the repository's profile, and writes and prints what they allow", async () => {
	const io = fakeIo(base);

	await up({ repo, label: "web-1", root: "/root" }, io);

	const secret = io.calls.find((c) => c[0] === "sbx" && c[1] === "secret")!;
	const run = io.calls.find((c) => c[0] === "sbx" && c[1] === "run")!;
	const permissions = io.files["/home/me/.sandboxes/webapp/pi-webapp-web-1/permissions.md"];
	assert.equal(secret.at(-1), "op://Dev/GitHub PAT webapp/credential");
	assert.equal(run[run.indexOf("--static-mcp") + 1], "linear-acme-readonly");
	assert.deepEqual([run[run.indexOf("--memory") + 1], run[run.indexOf("--cpus") + 1]], ["12g", "4"]);
	assert.match(permissions, /^# Permissions: acme\/webapp\n/);
	assert.match(permissions, /^- linear `read`: read Linear through `linear-acme-readonly`/m);
	assert.ok(io.lines.includes(permissions));
	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c.includes("gh")));
});

test("up attaches no Linear server where the profile gives none, and --memory and --cpus still win", async () => {
	const io = fakeIo({ ...base, "git remote get-url origin": "git@github.com:alice/cv.git" });

	await up({ repo, label: "web-1", root: "/root", memory: "16g", cpus: "8" }, io);

	const run = io.calls.find((c) => c[0] === "sbx" && c[1] === "run")!;
	assert.ok(!run.includes("--static-mcp"));
	assert.deepEqual([run[run.indexOf("--memory") + 1], run[run.indexOf("--cpus") + 1]], ["16g", "8"]);
	assert.equal(io.calls.find((c) => c[0] === "sbx" && c[1] === "secret")!.at(-1), "op://Dev/GitHub PAT Personal/credential");
	assert.match(io.files["/home/me/.sandboxes/webapp/pi-webapp-web-1/permissions.md"], /^- resources: 16g memory, 8 cpus$/m);
});

const pushing = {
	...base,
	"read /root/host/repos.json": WITH_PRIVATE,
	"git remote get-url origin": "git@github.com:alice/private-app.git",
	"herdr workspace list": { result: { workspaces: [{ workspace_id: "w1", label: "private-app" }] } },
};
const privateRepos = "sbx exec claude-private-app-x gh api /user/repos";
const fromSession = JSON.stringify({
	...JSON.parse(REAL_PROFILES),
	[PRIVATE_REPO]: { ...PRIVATE_PROFILE, container: { ...PRIVATE_PROFILE.container, token: "env:GH_TOKEN" } },
});

test("where the profile takes the container token from the session, up hands it to sbx on stdin and asks 1Password nothing", async () => {
	const io = fakeIo({ ...pushing, "read /root/host/repos.json": fromSession, [privateRepos]: "alice/private-app", "env GH_TOKEN": "github_pat_session" }, HARNESSES.claude);

	await up({ repo: "/r/private-app", label: "x", root: "/root" }, io);

	const sbx = io.calls.filter((c) => c[0] === "sbx");
	const secret = sbx.findIndex((c) => c[1] === "secret");
	assert.deepEqual(sbx[secret], ["sbx", "secret", "set", "github", "--sandbox", "claude-private-app-x"]);
	assert.equal(io.sbxOpts[secret]?.input, "github_pat_session");
	assert.ok(!io.calls.some((c) => c.includes("--ref")));
});

test("where the profile takes the container token from the session and the session has none, up stops before creating anything", async () => {
	const io = fakeIo({ ...pushing, "read /root/host/repos.json": fromSession }, HARNESSES.claude);

	await assert.rejects(up({ repo: "/r/private-app", label: "x", root: "/root" }, io), /alice\/private-app takes its container token from GH_TOKEN, and this session has none: start claude with GH_TOKEN set/);
	assert.ok(!io.calls.some((c) => c[0] === "sbx" && (c[1] === "run" || c[1] === "secret")));
});

test("where the container may push, up keeps a token that sees this private repository alone", async () => {
	const io = fakeIo({ ...pushing, [privateRepos]: "alice/private-app" }, HARNESSES.claude);

	await up({ repo: "/r/private-app", label: "x", root: "/root" }, io);

	assert.ok(io.calls.some((c) => c.join(" ").startsWith(privateRepos)));
	const run = io.calls.find((c) => c[0] === "sbx" && c[1] === "run")!;
	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c[1] === "rm"));
	assert.equal(run[run.indexOf("--memory") + 1], "4g");
});

test("where the container may push, up keeps a token that sees no private repository, as for a public project", async () => {
	const io = fakeIo({ ...pushing, [privateRepos]: "" }, HARNESSES.claude);

	await up({ repo: "/r/private-app", label: "x", root: "/root" }, io);

	assert.ok(io.calls.some((c) => c.join(" ").startsWith(privateRepos)));
	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c[1] === "rm"));
});

test("where the container may push, up removes the container whose token sees another private repository", async () => {
	const io = fakeIo({ ...pushing, [privateRepos]: "alice/private-app\nalice/diary" }, HARNESSES.claude);

	await assert.rejects(
		up({ repo: "/r/private-app", label: "x", root: "/root" }, io),
		/container was removed[\s\S]*no private repository other than alice\/private-app; it sees alice\/private-app, alice\/diary/,
	);
	assert.deepEqual(io.calls.at(-1), ["sbx", "rm", "-f", "claude-private-app-x"]);
	assert.equal(io.files["/home/me/.sandboxes/private-app/claude-private-app-x/permissions.md"], undefined);
});
