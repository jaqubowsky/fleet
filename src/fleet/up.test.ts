import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeIo } from "./fake-io.ts";
import { cacheStore, envFiles, up } from "./up.ts";

const repo = "/Users/me/Work/webapp";
const base = {
	"git remote get-url origin": "git@github.com:acme/webapp.git",
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
};

test("up creates the container, switches the branch, starts the install in the background, opens a tab and sends no prompt", async () => {
	const io = fakeIo({
		...base,
		"git ls-files -- :(glob)**/yarn.lock": "yarn.lock",
	});
	const out = await up(
		{ repo, label: "web-1", root: "/root", branch: "web-1" },
		io,
	);
	assert.deepEqual(out, {
		sandbox: "pi-webapp-web-1",
		agent: "webapp-web-1",
		pane: "w1:p9",
	});
	const run = io.calls.find((c) => c[0] === "sbx" && c[1] === "run")!;
	assert.ok(
		run.includes("--clone") &&
			run.includes("--static-mcp") &&
			!run.some((a) => /memory_mib/.test(a)),
	);
	assert.ok(io.calls.some((c) => c[0] === "sbx" && c[1] === "secret"));
	const execs = io.calls.filter((c) => c[0] === "sbx" && c[1] === "exec");
	assert.deepEqual(execs[0], [
		"sbx",
		"exec",
		"pi-webapp-web-1",
		"sh",
		"-c",
		'cd "$WORKSPACE_DIR" && (git switch "$1" 2>/dev/null || git switch -c "$1")',
		"--",
		"web-1",
	]);
	assert.match(
		execs[1][5],
		/^setsid nohup bash -c "\$1" >\/tmp\/fleet-install\.log/,
	);
	assert.match(execs[1][7], /yarn install --frozen-lockfile/);
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
			"HERDR_AGENT=pi sbx run --name pi-webapp-web-1 -- --approve",
		],
	);
	assert.ok(!io.calls.some((c) => c[1] === "agent" && c[2] === "prompt"));
	assert.deepEqual(io.calls.at(-1), [
		"herdr",
		"agent",
		"rename",
		"w1:p9",
		"webapp-web-1",
	]);
});

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
		"git ls-files -- :(glob)**/yarn.lock": "yarn.lock",
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
						name: "webapp-web-1",
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
						name: "webapp-web-1",
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
		result: { tabs: [{ tab_id: "w1:t7", label: "webapp-web-1" }] },
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
		"webapp-web-1",
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
				c[1] === "tab" && c[2] === "rename" && c[3] === "w2:t1" && c[4] === "cv-x",
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
		/did not come up/,
	);
	const unknown = fakeIo({
		...base,
		"herdr agent get w1:p9": { result: { agent: { agent_status: "unknown" } } },
	});
	await assert.rejects(
		up({ repo, label: "web-1", root: "/root" }, unknown),
		/did not come up/,
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
	assert.deepEqual(run.slice(-6), [
		repo,
		"/home/me/.sandboxes/webapp",
		"/home/me/.pi/cache/webapp",
		"/home/me/my-knowledge-base:ro",
		"--",
		"--approve",
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
	assert.ok(!none.calls.some((c) => c[0] === "sbx" && c[1] === "cp"));
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
		"git ls-files -- :(glob)**/yarn.lock": "yarn.lock",
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
		"the package manager cache was put on the shared mount",
	);
	assert.ok(
		!run.some((a) => String(a).startsWith("npm_config_cache")),
		"the package manager cache was put on the shared mount",
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

	assert.ok(io.calls.some((c) => c[0] === "mkdir" && c[1] === `${task}/logs/sessions`));
	assert.match(io.files[`${task}/task.md`], /^# web-1\n[\s\S]*Branch: web-1\n[\s\S]*## Acceptance criteria/);
	assert.match(io.files[`${task}/status.md`], /^status: new\nattention: none\ncommit: none\npr: none\n\n## Plan\n/);
	const run = io.calls.find((c) => c[0] === "sbx" && c[1] === "run")!;
	assert.ok(run.includes(`PI_CODING_AGENT_SESSION_DIR=${task}/logs/sessions`));

	const again = fakeIo({ ...base, [`read ${task}/task.md`]: "# kept", [`read ${task}/status.md`]: "status: implementing" });
	await up({ repo, label: "web-1", root: "/root" }, again);
	assert.ok(!again.calls.some((c) => c[0] === "write"));
});

test("up hands --model to pi and resumes the last session when one is on disk", async () => {
	const task = "/home/me/.sandboxes/webapp/pi-webapp-web-1";
	const fresh = fakeIo(base);
	await up({ repo, label: "web-1", root: "/root", model: "openai-codex/gpt-5.6-luna:high" }, fresh);
	assert.equal(
		fresh.calls.find((c) => c[1] === "pane")![4],
		"HERDR_AGENT=pi sbx run --name pi-webapp-web-1 -- --approve --model openai-codex/gpt-5.6-luna:high",
	);

	const resumed = fakeIo({ ...base, [`list ${task}/logs/sessions`]: ["--Users-me-Work-webapp--"] });
	await up({ repo, label: "web-1", root: "/root" }, resumed);
	assert.equal(
		resumed.calls.find((c) => c[1] === "pane")![4],
		"HERDR_AGENT=pi sbx run --name pi-webapp-web-1 -- --approve -c",
	);
});
