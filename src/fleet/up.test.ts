import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type TestContext, test } from "node:test";
import { fakeIo } from "./fake-io.ts";
import { manifestPath, taskDir } from "./repositories.ts";
import { SEATS, KINDS } from "../harness.ts";
import { SWITCH_TO_BRANCH, cacheDir, cacheStore, envFiles, up } from "./up.ts";
import {
	PRIVATE_PROFILE,
	PRIVATE_REPO,
	SAMPLE_PROFILES,
	WITH_PRIVATE,
} from "../profile/fixture.ts";

const repo = "/Users/me/Work/webapp";
const containerLocks =
	'sbx exec pi-webapp-web-1 sh -c cd "$WORKSPACE_DIR" && git ls-files';
const base = {
	"read /root/host/repos.json": SAMPLE_PROFILES,
	"read /home/me/.config/sbx/credentials.yaml":
		"bindings:\n  openai:\n    oauth:\n",
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
	[`sbx exec pi-webapp-web-1 git -C ${repo} rev-parse refs/fleet/base`]:
		"3".repeat(40),
	[`sbx exec claude-webapp-web-1 git -C ${repo} rev-parse refs/fleet/base`]:
		"3".repeat(40),
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
				c[1] === "/home/me/.sandboxes/fleet-events.log" &&
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
	const install = execs.find((c) => c[5].startsWith("setsid nohup"))!;
	assert.match(
		install[5],
		/^setsid nohup bash -c "\$1" >\/tmp\/fleet-install\.log/,
	);
	assert.match(install[7], /yarn install --frozen-lockfile/);
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
	assert.deepEqual(
		JSON.parse(io.files["/home/me/.config/harness/fleet/pi-webapp-web-1.json"]),
		{
			version: 1,
			task: "/home/me/.sandboxes/webapp/pi-webapp-web-1",
			repositories: [
				{
					repo,
					name: "acme/webapp",
					base: "main",
					baseSha: "3".repeat(40),
					branch: "web-1",
					workspace: repo,
					served: "",
				},
			],
		},
	);
	assert.equal(
		io.files["/home/me/.sandboxes/webapp/pi-webapp-web-1/repositories.json"],
		undefined,
	);
	assert.doesNotMatch(
		io.files["/home/me/.sandboxes/webapp/pi-webapp-web-1/status.md"],
		/## Repositories/,
	);
	assert.deepEqual(io.calls.at(-1), [
		"herdr",
		"agent",
		"rename",
		"w1:p9",
		"pi-webapp-web-1",
	]);
});

test("one-repository up takes its base from the container when the host never fetched it", async () => {
	const io = fakeIo({
		...base,
		[containerLocks]: "yarn.lock",
		[`git ${repo} rev-parse origin/release`]: new Error("fatal: ambiguous argument 'origin/release'"),
	});

	await up({ repo, label: "web-1", root: "/root", base: "release" }, io);

	const manifest = JSON.parse(io.files[manifestPath("pi-webapp-web-1", io)]);
	assert.equal(manifest.repositories[0].baseSha, "3".repeat(40));
});

test("up keeps two writable private clones with their own bases", async () => {
	const api = "/Users/me/Work/api";
	const io = fakeIo({
		...base,
		[`git ${api} remote get-url origin`]: "git@github.com:acme/api.git",
		[`git ${api} rev-parse --abbrev-ref origin/HEAD`]: "origin/develop",
		[`sbx exec pi-webapp-web-1 git -C ${repo} rev-parse refs/fleet/base`]:
			"3".repeat(40),
		"sbx exec pi-webapp-web-1 git -C /tmp/fleet-repos/api rev-parse refs/fleet/base":
			"4".repeat(40),
		"git ls-files --others --ignored": ".env\n.env.test\n",
		'sbx exec pi-webapp-web-1 sh -c cd "$1" && shift && git ls-files':
			"pnpm-lock.yaml",
	});
	const sbx = io.sbx;
	io.sbx = (args, opts) => {
		const printed = sbx(args, opts);
		if (args[0] === "exec" && args[4]?.startsWith('cd "$1" && printf'))
			return `web-1\t0\t${(args.at(-1) === "/tmp/fleet-repos/api" ? "4" : "3").repeat(40)}`;
		return printed;
	};

	await up({ repo, repos: [api], label: "web-1", root: "/root" }, io);

	const run = io.calls.find((call) => call[0] === "sbx" && call[1] === "run")!;
	assert.ok(run.includes("--clone"));
	assert.ok(run.includes("FLEET_REPOSITORIES=2"));
	assert.ok(
		!run.includes(api),
		"the API checkout must not be mounted from the host",
	);
	assert.ok(
		io.calls.some(
			(call) =>
				call[0] === "git" &&
				call[1] === api &&
				call[2] === "bundle" &&
				call[3] === "create",
		),
	);
	assert.ok(
		io.calls.some(
			(call) =>
				call[0] === "sbx" && call[1] === "cp" && call[2]?.endsWith(".bundle"),
		),
	);
	assert.ok(
		io.calls.some(
			(call) =>
				call[0] === "sbx" &&
				call[1] === "exec" &&
				call.join(" ").includes("git init") &&
				call.join(" ").includes("git -C") &&
				call.join(" ").includes("fetch"),
		),
	);
	const manifestFile = Object.keys(io.files).find((path) =>
		path.endsWith("/pi-webapp-web-1/repositories.json"),
	);
	assert.ok(manifestFile);
	const task = dirname(manifestFile);
	assert.match(
		task,
		/^\/home\/me\/\.sandboxes\/groups\/[^/]+\/pi-webapp-web-1$/,
	);
	assert.ok(run.includes(`FLEET_ARTIFACTS=${dirname(task)}`));
	const listed = JSON.parse(io.files[manifestFile]);
	assert.equal(listed.task, task);
	assert.deepEqual(
		listed.repositories.map((entry: { baseSha: string }) => entry.baseSha),
		["3".repeat(40), "4".repeat(40)],
	);
	assert.match(io.files[`${task}/status.md`], /base origin\/main 3{40}/);
	assert.match(io.files[`${task}/status.md`], /base origin\/develop 4{40}/);
	assert.match(
		io.files[`${task}/status.md`],
		/acme\/webapp: web-1 dirty 0 3{40}/,
	);
	assert.match(
		io.files[`${task}/status.md`],
		/acme\/api: web-1 dirty 0 4{40}/,
	);
	assert.match(io.files[`${task}/permissions.md`], /acme\/api/);
	const copied = io.calls
		.filter((call) => call[0] === "sbx" && call[1] === "cp")
		.map((call) => call[2]);
	assert.deepEqual(
		copied.filter((path) => path.includes("/.env")),
		[`${repo}/.env`, `${repo}/.env.test`, `${api}/.env`, `${api}/.env.test`],
	);
	const apiInstall = io.calls.find(
		(call) =>
			call[0] === "sbx" &&
			call[1] === "exec" &&
			call[5]?.includes("/tmp/fleet-install-api.log"),
	)!;
	assert.equal(apiInstall.at(-2), "/tmp/fleet-repos/api");
	assert.match(apiInstall.at(-1)!, /pnpm install --frozen-lockfile/);
});

test("up isolates colliding checkout names and shares an order-independent group runbook", async () => {
	const repos = [
		repo,
		"/Users/me/Two/webapp",
		"/Users/me/Three/webapp",
		"/Users/me/Four/2-webapp",
	];
	const io = fakeIo({
		...base,
		"git submodule status": " abc libs/shared (heads/main)",
	});
	const git = io.git;
	io.git = (args, cwd) =>
		args.join(" ") === "remote get-url origin"
			? `git@github.com:acme/repo-${repos.indexOf(cwd) + 1}.git`
			: git(args, cwd);
	const sbx = io.sbx;
	io.sbx = (args, opts) => {
		const result = sbx(args, opts);
		if (args.at(-1) === "refs/fleet/base") return "1".repeat(40);
		if (args[4]?.startsWith('cd "$1" && printf'))
			return `web-1\t0\t${"2".repeat(40)}`;
		return result;
	};

	await up({ repo, repos: repos.slice(1), label: "web-1", root: "/root" }, io);

	const manifest = JSON.parse(io.files[manifestPath("pi-webapp-web-1", io)]);
	assert.match(
		manifest.task,
		/^\/home\/me\/\.sandboxes\/groups\/[^/]{1,180}\/pi-webapp-web-1$/,
	);
	assert.equal(manifest.repositories.length, 4);
	assert.equal(
		new Set(
			manifest.repositories.map((entry: { workspace: string }) => entry.workspace),
		).size,
		4,
	);
	const run = io.calls.find((call) => call[0] === "sbx" && call[1] === "run")!;
	assert.ok(run.includes("FLEET_REPOSITORIES=4"));
	assert.ok(run.includes(`FLEET_ARTIFACTS=${dirname(manifest.task)}`));
	for (const entry of manifest.repositories.slice(1)) {
		assert.ok(!run.includes(entry.repo));
		assert.ok(
			io.calls.some(
				(call) =>
					call[1] === "cp" &&
					call[2] === `${entry.repo}/libs/shared` &&
					call[3] === `pi-webapp-web-1:${entry.workspace}/libs/`,
			),
		);
	}
	const bundles = io.calls
		.filter(
			(call) => call[0] === "git" && call[2] === "bundle" && call[3] === "create",
		)
		.map((call) => call[4]);
	assert.equal(new Set(bundles).size, 3);
	assert.ok(io.files[`${dirname(manifest.task)}/runbook/README.md`]);
	const reversed = {
		...io,
		read: (path: string) =>
			path.includes("/.config/harness/fleet/") ? undefined : io.read(path),
	};
	assert.equal(
		dirname(taskDir(repos[2], "another", reversed, [repos[3], repos[1], repo])),
		dirname(manifest.task),
	);
});

test("up refuses incompatible group credential or Linear bindings before creation", async () => {
	for (const [field, binding] of [["token", "keychain:other"], ["linearServer", "different-binding"]] as const) {
		const profiles = JSON.parse(SAMPLE_PROFILES);
		profiles["acme/other"] = {
			...profiles["acme/*"],
			container: {
				...profiles["acme/*"].container,
				[field]: binding,
			},
		};
		const io = fakeIo({
			...base,
			"read /root/host/repos.json": JSON.stringify(profiles),
			"git /other remote get-url origin": "git@github.com:acme/other.git",
		});

		await assert.rejects(
			up({ repo, repos: ["/other"], label: "web-1", root: "/root" }, io),
			/acme\/other.*shared sandbox.*binding/,
		);
		assert.ok(!io.calls.some((call) => call[0] === "sbx" && call[1] === "run"));
	}
});

test("up applies one explicit base to both repositories", async () => {
	const api = "/Users/me/Work/api";
	const io = fakeIo({
		...base,
		[`git ${api} remote get-url origin`]: "git@github.com:acme/api.git",
		[`git ${api} rev-parse --abbrev-ref origin/HEAD`]: "origin/main",
		[`sbx exec pi-webapp-web-1 git -C ${repo} rev-parse refs/fleet/base`]:
			"1".repeat(40),
		"sbx exec pi-webapp-web-1 git -C /tmp/fleet-repos/api rev-parse refs/fleet/base":
			"2".repeat(40),
	});

	await up(
		{ repo, repos: [api], base: "dev", label: "web-1", root: "/root" },
		io,
	);

	assert.deepEqual(
		JSON.parse(io.files[manifestPath("pi-webapp-web-1", io)]).repositories.map(
			(entry: { base: string }) => entry.base,
		),
		["dev", "dev"],
	);
});

test("up gives each repository its own explicit base", async () => {
	const api = "/Users/me/Work/api";
	const io = fakeIo({
		...base,
		[`git ${api} remote get-url origin`]: "git@github.com:acme/api.git",
		[`sbx exec pi-webapp-web-1 git -C ${repo} rev-parse refs/fleet/base`]:
			"1".repeat(40),
		"sbx exec pi-webapp-web-1 git -C /tmp/fleet-repos/api rev-parse refs/fleet/base":
			"2".repeat(40),
	});

	await up(
		{ repo, repos: [api], bases: ["main", "dev"], label: "web-1", root: "/root" },
		io,
	);

	assert.deepEqual(
		JSON.parse(io.files[manifestPath("pi-webapp-web-1", io)]).repositories.map(
			(entry: { base: string }) => entry.base,
		),
		["main", "dev"],
	);
});

test("up distinguishes two repositories with the same checkout basename", async () => {
	const other = "/Users/me/Other/webapp";
	const io = fakeIo({
		...base,
		[`git ${other} remote get-url origin`]: "git@github.com:acme/api.git",
		[`sbx exec pi-webapp-web-1 git -C ${repo} rev-parse refs/fleet/base`]:
			"1".repeat(40),
		"sbx exec pi-webapp-web-1 git -C /tmp/fleet-repos/2-webapp rev-parse refs/fleet/base":
			"2".repeat(40),
	});

	await up({ repo, repos: [other], label: "web-1", root: "/root" }, io);

	const manifest = JSON.parse(io.files[manifestPath("pi-webapp-web-1", io)]);
	assert.deepEqual(
		manifest.repositories.map((entry: { name: string }) => entry.name),
		["acme/webapp", "acme/api"],
	);
	assert.equal(manifest.repositories[1].workspace, "/tmp/fleet-repos/2-webapp");
	assert.ok(
		!io.calls
			.find((call) => call[0] === "sbx" && call[1] === "run")!
			.includes(other),
	);
});

test("claude seeds each repository's ignored agent config into its private clone", async () => {
	const api = "/Users/me/Work/api";
	const io = fakeIo(
		{
			...base,
			[`git ${api} remote get-url origin`]: "git@github.com:acme/api.git",
			[`sbx exec claude-webapp-web-1 git -C ${repo} rev-parse refs/fleet/base`]:
				"1".repeat(40),
			"sbx exec claude-webapp-web-1 git -C /tmp/fleet-repos/api rev-parse refs/fleet/base":
				"2".repeat(40),
			[`git ${api} ls-files --others --ignored`]: ".claude/settings.local.json\n",
		},
		SEATS.claude,
	);

	await up({ repo, repos: [api], label: "web-1", root: "/root" }, io);

	assert.ok(
		io.calls.some(
			(call) =>
				call[0] === "sbx" &&
				call[1] === "cp" &&
				call[2] === `${api}/.claude/settings.local.json` &&
				call[3] === "claude-webapp-web-1:/tmp/fleet-repos/api/.claude/",
		),
	);
	assert.ok(
		!io.calls
			.find((call) => call[0] === "sbx" && call[1] === "run")!
			.includes(api),
	);
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

for (const harness of [SEATS.claude]) {
	test(`up waits for the ${harness.name} process even when herdr already reports a status`, async () => {
		const io = fakeIo(base, harness);
		const sbx = io.sbx;
		let probes = 0;
		io.sbx = (args, opts) => {
			if (args[0] === "exec" && args[2] === "pgrep") {
				probes++;
				assert.deepEqual(args.slice(2), ["pgrep", "-x", harness.name]);
				if (probes === 1) throw new Error("exit status 1");
				return "42";
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
			`${harness.name}-webapp-web-1`,
		]);
	});

	test(`up fails with the probe's error when the ${harness.name} process never starts`, async () => {
		const io = fakeIo(
			{
				...base,
				[`sbx exec ${harness.name}-webapp-web-1 pgrep`]: new Error(
					"pgrep exit status 1",
				),
			},
			harness,
		);

		await assert.rejects(
			up({ repo, label: "web-1", root: "/root" }, io),
			/did not become ready.*process probe: Error: pgrep exit status 1/,
		);
	});
}

test("up warns and continues when the GitHub token cannot be bound", async () => {
	const io = fakeIo({
		...base,
		"sbx secret set github": new Error("sbx: exit status 1"),
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
		[`sbx exec pi-webapp-web-1 git -C ${repo} rev-parse --absolute-git-dir`]: `${repo}/.git`,
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

test("up names the branch after the label as a ref git takes, and refuses the default branch before any container exists", async () => {
	const named = fakeIo(base);
	await up({ repo, label: "WEB 1", root: "/root" }, named);
	const switched = named.calls.find(
		(c) => c[0] === "sbx" && c[1] === "exec" && c[5] === SWITCH_TO_BRANCH,
	);
	assert.equal(switched?.[7], "web-1");

	for (const input of [{ label: "main" }, { label: "web-1", branch: "main" }]) {
		const io = fakeIo(base);
		await assert.rejects(
			up({ repo, root: "/root", ...input }, io),
			/main is the default branch/,
		);
		assert.ok(
			!io.calls.some((c) => c[0] === "sbx" && c[1] === "run"),
			JSON.stringify(input),
		);
	}
});

test("up without --branch switches to a branch named from the label, and resolves the repo to its top level", async () => {
	const io = fakeIo({ ...base, "git rev-parse --show-toplevel": repo });
	const out = await up(
		{ repo: `${repo}/apps/web`, label: "web-1", root: "/root" },
		io,
	);
	assert.equal(out.sandbox, "pi-webapp-web-1");
	const switched = io.calls.find(
		(c) => c[0] === "sbx" && c[1] === "exec" && c[5] === SWITCH_TO_BRANCH,
	);
	assert.equal(switched?.[7], "web-1");
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
			result: { panes: [{ pane_id: "w1:p7", tab_id: "w1:t7", agent: "claude" }] },
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
		/already runs claude/,
	);

	assert.deepEqual(created(held), []);
	assert.deepEqual(created(tab), []);
});

test("up reuses an existing container and only opens the tab", async () => {
	const io = fakeIo({
		...base,
		"sbx ls --json": {
			sandboxes: [
				{
					name: "pi-webapp-web-1",
					agent: "pi",
					status: "stopped",
					workspaces: [],
				},
			],
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
		"sbx exec pi-cv-x git -C /r/cv rev-parse refs/fleet/base": "3".repeat(40),
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
	assert.deepEqual(run.slice(-7), [
		repo,
		"/home/me/.sandboxes/webapp",
		"/home/me/.pi/cache/webapp",
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

	const chown = io.calls.find(
		(c) => c[0] === "sbx" && c.some((a) => a.includes("chown")),
	)!;
	assert.deepEqual(chown.slice(-3), ["/w", "apps/api/.env", ".env.docker"]);
	const copies = io.calls.filter(
		(c) => c[0] === "sbx" && c[1] === "cp" && c[2].includes(".env"),
	);
	assert.ok(
		io.calls.indexOf(chown) > io.calls.indexOf(copies[copies.length - 1]),
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
	const listed = io.calls.findIndex(
		(c) => c[0] === "sbx" && String(c[5]).includes("git ls-files"),
	);
	assert.ok(
		switched >= 0 && listed > switched,
		"lockfiles listed before the branch switch",
	);
	assert.ok(
		io.calls.some(
			(c) => c[0] === "sbx" && String(c[5]).includes("fleet-install"),
		),
	);
});

test("a lockfile only the host checkout holds starts no install", async () => {
	const io = fakeIo({
		...base,
		"git ls-files -- :(glob)**/yarn.lock": "yarn.lock",
		[containerLocks]: "",
	});
	await up({ repo, label: "web-1", root: "/root" }, io);

	assert.ok(
		!io.calls.some(
			(c) => c[0] === "sbx" && String(c[5]).includes("fleet-install"),
		),
	);
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
		[`sbx exec pi-webapp-web-1 git -C ${repo} rev-parse --absolute-git-dir`]: `${repo}/.git`,
	});
	await up({ repo, label: "web-1", root: "/root" }, io);

	const registered = io.calls.find(
		(c) => c[0] === "sbx" && String(c[5] ?? "").includes("gitdir:"),
	)!;
	assert.ok(registered, "the submodule was never registered");
	assert.deepEqual(registered.slice(6), [
		"--",
		`${repo}/.git/modules/packages/pdf-generator`,
		`${repo}/packages/pdf-generator`,
	]);
});

test("a submodule of an extra repository lives under the git dir the clone reports", async () => {
	const api = "/Users/me/Work/api";
	const gitDir = `${repo}/.git/fleet-repos/api.git`;
	const io = fakeIo({
		...base,
		[`git ${api} remote get-url origin`]: "git@github.com:acme/api.git",
		[`git ${api} submodule status`]: " 1495ab0 libs/shared (v1)\n",
		[`sbx exec pi-webapp-web-1 git -C ${repo} rev-parse refs/fleet/base`]:
			"3".repeat(40),
		"sbx exec pi-webapp-web-1 git -C /tmp/fleet-repos/api rev-parse refs/fleet/base":
			"4".repeat(40),
		"sbx exec pi-webapp-web-1 git -C /tmp/fleet-repos/api rev-parse --absolute-git-dir":
			gitDir,
	});

	await up({ repo, repos: [api], label: "web-1", root: "/root" }, io);

	assert.ok(
		io.calls.some(
			(c) =>
				c[0] === "sbx" &&
				c[1] === "cp" &&
				c[2] === `${api}/.git/modules/libs/shared` &&
				c[3] === `pi-webapp-web-1:${gitDir}/modules/libs/`,
		),
	);
	const registered = io.calls.find(
		(c) => c[0] === "sbx" && String(c[5] ?? "").includes("gitdir:"),
	)!;
	assert.deepEqual(registered.slice(6), [
		"--",
		`${gitDir}/modules/libs/shared`,
		"/tmp/fleet-repos/api/libs/shared",
	]);
});

test("the seeding scripts leave a working submodule behind a separate git dir", async (t) => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "up-submodule-")));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" };
	const git = (dir: string, ...args: string[]) =>
		execFileSync(
			"git",
			[
				"-C",
				dir,
				"-c",
				"user.name=t",
				"-c",
				"user.email=t@t",
				"-c",
				"protocol.file.allow=always",
				...args,
			],
			{ encoding: "utf8", env },
		).trim();
	const lib = join(root, "lib");
	const host = join(root, "host");
	execFileSync("git", ["init", "--quiet", lib], { env });
	git(lib, "commit", "--quiet", "--allow-empty", "-m", "lib");
	execFileSync("git", ["init", "--quiet", host], { env });
	git(host, "submodule", "--quiet", "add", lib, "libs/shared");
	git(host, "commit", "--quiet", "-m", "with submodule");
	const guest = join(root, "guest");
	const gitDir = join(root, "primary", ".git", "fleet-repos", "api.git");
	mkdirSync(dirname(gitDir), { recursive: true });
	execFileSync("git", ["clone", "--quiet", "--separate-git-dir", gitDir, host, guest], { env });
	const io = fakeIo({
		...base,
		"sbx exec pi-webapp-web-1 sh -c printf": guest,
		"git submodule status": " 1495ab0 libs/shared (v1)\n",
		[`sbx exec pi-webapp-web-1 git -C ${guest} rev-parse --absolute-git-dir`]: gitDir,
	});
	const fakeSbx = io.sbx;
	io.sbx = (args, opts) => {
		const printed = fakeSbx(args, opts);
		if (args[0] === "cp" && args[2].startsWith("pi-webapp-web-1:") && args[1].startsWith(repo)) {
			const from = args[1].replace(repo, host);
			const to = args[2].slice("pi-webapp-web-1:".length);
			execFileSync("cp", ["-R", from, to]);
		}
		if (
			args[0] === "exec" &&
			args[2] === "sh" &&
			/^(mkdir -p "\$1" "\$2"$|printf "gitdir|cd "\$1" && git submodule init)/.test(args[4])
		)
			execFileSync("sh", ["-c", args[4], ...args.slice(5)], { env });
		return printed;
	};

	await up({ repo, label: "web-1", root: "/root" }, io);

	assert.match(git(join(guest, "libs/shared"), "status", "--porcelain=v1", "--branch"), /^## /);
	assert.equal(
		git(join(guest, "libs/shared"), "rev-parse", "--absolute-git-dir"),
		join(gitDir, "modules/libs/shared"),
	);
	assert.match(git(guest, "submodule", "status"), /libs\/shared/);
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

for (const harness of Object.values(KINDS)) {
	test(`the ${harness.name} container keeps its npm cache in the repository's shared cache`, async () => {
		const io = fakeIo(base, SEATS[harness.name]);
		await up({ repo, label: "web-1", root: "/root" }, io);
		const run = io.calls.find((c) => c[0] === "sbx" && c[1] === "run")!;

		assert.ok(
			run.includes(`npm_config_cache=${cacheDir(repo, harness, io)}/npm`),
		);
		assert.ok(run.includes(cacheDir(repo, harness, io)));
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
		"status: new\nattention: none\n\n## Log\n",
	);
	const run = io.calls.find((c) => c[0] === "sbx" && c[1] === "run")!;
	assert.ok(run.includes(`PI_CODING_AGENT_SESSION_DIR=${task}/logs/sessions`));

	const again = fakeIo({
		...base,
		[`read ${task}/status.md`]: "status: implementing",
	});
	await up({ repo, label: "web-1", root: "/root" }, again);
	assert.deepEqual(
		again.calls
			.filter((c) => c[0] === "write" && c[1].startsWith(`${task}/`))
			.map((c) => c[1]),
		[`${task}/permissions.md`],
	);
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

function originWithClone(t: TestContext): {
	origin: string;
	seed: string;
	workspace: string;
	git: (dir: string, ...args: string[]) => string;
} {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "up-branch-")));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const git = (dir: string, ...args: string[]) =>
		execFileSync(
			"git",
			[
				"-C",
				dir,
				"-c",
				"user.name=t",
				"-c",
				"user.email=t@t",
				"-c",
				"commit.gpgsign=false",
				...args,
			],
			{ encoding: "utf8" },
		).trim();
	const origin = join(root, "origin.git");
	const seed = join(root, "seed");
	const workspace = join(root, "workspace");
	execFileSync("git", ["init", "--quiet", "--bare", "-b", "main", origin]);
	execFileSync("git", ["clone", "--quiet", origin, seed], { stdio: "ignore" });
	git(seed, "commit", "--quiet", "--allow-empty", "-m", "base");
	git(seed, "push", "--quiet", "origin", "main");
	execFileSync("git", ["clone", "--quiet", origin, workspace], {
		stdio: "ignore",
	});
	return { origin, seed, workspace, git };
}

const branchScript = (workspace: string, branch: string) =>
	execFileSync("sh", ["-c", SWITCH_TO_BRANCH, "--", branch, "main"], {
		env: { ...process.env, WORKSPACE_DIR: workspace },
		encoding: "utf8",
	}).trim();

const pushTicket = (
	seed: string,
	git: (dir: string, ...args: string[]) => string,
) => {
	git(seed, "switch", "--quiet", "-c", "ticket/04");
	git(seed, "commit", "--quiet", "--allow-empty", "-m", "ticket work");
	git(seed, "push", "--quiet", "origin", "ticket/04");
};

test("a bundle builds a writable private API clone without changing the host checkout", async (t) => {
	const { origin, workspace, git } = originWithClone(t);
	const head = git(workspace, "rev-parse", "HEAD");
	const io = fakeIo({
		...base,
		[`git ${workspace} remote get-url origin`]: "git@github.com:acme/api.git",
		[`sbx exec pi-webapp-web-1 git -C ${repo} rev-parse refs/fleet/base`]:
			"a".repeat(40),
		"sbx exec pi-webapp-web-1 git -C /tmp/fleet-repos/workspace rev-parse refs/fleet/base":
			head,
	});

	await up({ repo, repos: [workspace], label: "web-1", root: "/root" }, io);

	const bundleCall = io.calls.find(
		(call) => call[0] === "git" && call[1] === workspace && call[2] === "bundle",
	)!;
	const bundle = join(dirname(workspace), "api.bundle");
	git(workspace, "bundle", "create", bundle, ...bundleCall.slice(5));
	const guestBundle = join(dirname(workspace), "inside.bundle");
	const guest = join(dirname(workspace), "sandbox-api");
	const primary = join(dirname(workspace), "primary");
	execFileSync("git", ["init", "--quiet", primary]);
	copyFileSync(bundle, guestBundle);
	const clone = io.calls.find(
		(call) =>
			call[0] === "sbx" &&
			call[1] === "exec" &&
			call[5]?.includes("git init --quiet"),
	)!;
	execFileSync(
		"sh",
		["-c", clone[5], "--", guestBundle, guest, origin, clone[10]],
		{ env: { ...process.env, WORKSPACE_DIR: primary } },
	);
	const switchBranch = io.calls.find(
		(call) =>
			call[0] === "sbx" &&
			call[1] === "exec" &&
			call[5]?.startsWith("export WORKSPACE_DIR"),
	)!;
	execFileSync("sh", ["-c", switchBranch[5], "--", guest, "web-1", "main"]);

	assert.equal(git(guest, "rev-parse", "HEAD"), head);
	assert.equal(
		git(guest, "rev-parse", "--absolute-git-dir"),
		join(primary, ".git/fleet-repos/workspace.git"),
	);
	assert.equal(git(primary, "status", "--porcelain"), "");
	const manifest = JSON.parse(
		io.files["/home/me/.config/harness/fleet/pi-webapp-web-1.json"],
	);
	assert.deepEqual(
		manifest.repositories.map((entry: { served: string }) => entry.served),
		["", "/.git/fleet-repos/workspace.git"],
	);
	git(guest, "commit", "--quiet", "--allow-empty", "-m", "sandbox-only");
	assert.notEqual(git(guest, "rev-parse", "HEAD"), head);
	assert.equal(git(workspace, "rev-parse", "HEAD"), head);
	assert.equal(git(workspace, "status", "--porcelain"), "");
});

test("up --branch picks up a branch that exists only on origin and says so", (t) => {
	const { seed, workspace, git } = originWithClone(t);
	pushTicket(seed, git);

	const out = branchScript(workspace, "ticket/04");

	assert.equal(
		git(workspace, "rev-parse", "HEAD"),
		git(seed, "rev-parse", "HEAD"),
	);
	assert.match(
		out,
		/^ticket\/04 continues the existing branch origin\/ticket\/04$/m,
	);
});

test("up --branch takes origin's branch over a stale local one", (t) => {
	const { seed, workspace, git } = originWithClone(t);
	git(workspace, "branch", "ticket/04");
	pushTicket(seed, git);

	branchScript(workspace, "ticket/04");

	assert.equal(
		git(workspace, "rev-parse", "HEAD"),
		git(seed, "rev-parse", "HEAD"),
	);
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

	assert.equal(
		git(workspace, "rev-parse", "HEAD"),
		git(seed, "rev-parse", "main"),
	);
	assert.equal(git(workspace, "branch", "--show-current"), "ticket/05");
	assert.equal(
		git(
			workspace,
			"config",
			"--default",
			"none",
			"--get",
			"branch.ticket/05.merge",
		),
		"none",
	);
	assert.match(out, /^ticket\/05 is new from origin\/main$/m);
});

test("up branches from the fetched base commit rather than a stale remote-tracking ref", (t) => {
	const { seed, workspace, git } = originWithClone(t);
	const stale = git(workspace, "rev-parse", "origin/main");
	git(seed, "commit", "--quiet", "--allow-empty", "-m", "new remote base");
	git(seed, "push", "--quiet", "origin", "main");
	const fresh = git(seed, "rev-parse", "HEAD");
	assert.notEqual(stale, fresh);

	const out = branchScript(workspace, "ticket/05");

	assert.equal(git(workspace, "rev-parse", "HEAD"), fresh);
	assert.equal(git(workspace, "rev-parse", "refs/fleet/base"), fresh);
	assert.match(out, /^ticket\/05 is new from origin\/main$/m);
});

test("up refuses a stale local base when the remote base cannot be fetched", (t) => {
	const { origin, seed, workspace, git } = originWithClone(t);
	const stale = git(workspace, "rev-parse", "origin/main");
	git(seed, "commit", "--quiet", "--allow-empty", "-m", "new remote base");
	git(seed, "push", "--quiet", "origin", "main");
	assert.notEqual(stale, git(seed, "rev-parse", "HEAD"));
	rmSync(origin, { recursive: true, force: true });

	assert.throws(
		() => branchScript(workspace, "ticket/05"),
		(error: Error & { stdout?: Buffer | string }) => {
			assert.match(error.message, /cannot refresh origin\/main/);
			assert.doesNotMatch(String(error.stdout ?? ""), /is new from origin\/main/);
			return true;
		},
	);
	assert.equal(git(workspace, "rev-parse", "HEAD"), stale);
	assert.throws(() =>
		git(workspace, "show-ref", "--verify", "refs/heads/ticket/05"),
	);
});

test("up logs which start the branch took", async () => {
	const io = fakeIo({
		...base,
		[`sbx exec pi-webapp-web-1 sh -c ${SWITCH_TO_BRANCH}`]:
			"web-1 continues the existing branch origin/web-1",
	});

	await up({ repo, label: "web-1", root: "/root", branch: "web-1" }, io);

	assert.ok(
		io.lines.includes(
			"pi-webapp-web-1: web-1 continues the existing branch origin/web-1",
		),
	);
});

test("a claude container is given colour, a pi container is left as it is", async () => {
	const claudeIo = fakeIo(base, SEATS.claude);
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
		SEATS.pi,
		".pi/agent/extensions/herdr-agent-state.ts",
		"HERDR_AGENT=pi /root/bin/fleet relay pi-webapp-web-1 /home/me/.sandboxes/webapp/pi-webapp-web-1 -- --approve --no-autoformat --no-lens-context",
	],
] as const) {
	test(`up copies herdr's ${h.name} integration into a new container and starts ${h.name} through the relay`, async () => {
		const io = fakeIo(base, h);

		await up({ repo, label: "web-1", root: "/root" }, io);

		assert.ok(
			io.calls.some(
				(c) =>
					c.join(" ") ===
					`sbx cp /home/me/${integration} ${KINDS[h.name].prefix}webapp-web-1:/home/agent/${integration}`,
			),
		);
		assert.equal(io.calls.find((c) => c[1] === "pane")![4], command);
	});
}

test("up of a claude container starts claude straight through sbx run and copies no herdr integration", async () => {
	const io = fakeIo(base, SEATS.claude);

	await up({ repo, label: "web-1", root: "/root" }, io);

	assert.equal(
		io.calls.find((c) => c[1] === "pane")![4],
		"HERDR_AGENT=claude sbx run --name claude-webapp-web-1",
	);
	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c[1] === "cp"));
});

test("up of a claude container empties the CLAUDE.md sbx writes beside the workspace, and fleet up leaves pi alone", async () => {
	const claude = fakeIo(base, SEATS.claude);
	const pi = fakeIo(base);

	await up({ repo, label: "web-1", root: "/root" }, claude);
	await up({ repo, label: "web-1", root: "/root" }, pi);

	const emptied = (io: typeof pi) =>
		io.calls.find(
			(c) => c[0] === "sbx" && c.some((a) => a.includes("truncate -s 0")),
		);
	assert.equal(emptied(claude)?.at(-1), "CLAUDE.md");
	assert.equal(emptied(pi), undefined);
});

test("up stops before creating anything when no sbx binding lets openai in, unless the model comes from elsewhere", async () => {
	const unbound = {
		...base,
		"read /home/me/.config/sbx/credentials.yaml": "bindings: {}\n",
	};
	const io = fakeIo(unbound);
	const openrouter = fakeIo(unbound);

	await assert.rejects(
		up({ repo, label: "web-1", root: "/root" }, io),
		/no sbx binding lets openai in/,
	);
	await up(
		{
			repo,
			label: "web-1",
			root: "/root",
			model: "openrouter/moonshotai/kimi-k2.6:high",
		},
		openrouter,
	);

	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c[1] === "run"));
	assert.ok(openrouter.calls.some((c) => c[0] === "sbx" && c[1] === "run"));
});

test("up of a claude container stops when claude in the new container is not logged in", async () => {
	const io = fakeIo(
		{
			...base,
			"herdr agent read w1:p9 --source visible": "Not logged in · Run /login",
		},
		SEATS.claude,
	);

	await assert.rejects(
		up({ repo, label: "web-1", root: "/root" }, io),
		/the container's agent is not logged in.*\/login in tab claude-webapp-web-1/,
	);
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
	const permissions =
		io.files["/home/me/.sandboxes/webapp/pi-webapp-web-1/permissions.md"];
	assert.equal(secret.at(-1), "security find-generic-password -s fleet-gh -a acme -w");
	assert.equal(run[run.indexOf("--static-mcp") + 1], "linear-acme-readonly");
	assert.deepEqual(
		[run[run.indexOf("--memory") + 1], run[run.indexOf("--cpus") + 1]],
		["12g", "4"],
	);
	assert.match(permissions, /^# Permissions: acme\/webapp\n/);
	assert.match(
		permissions,
		/^- linear `read`: read Linear through `linear-acme-readonly`/m,
	);
	assert.ok(io.lines.includes(permissions));
	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c.includes("gh")));
});

test("up attaches no Linear server where the profile gives none, and --memory and --cpus still win", async () => {
	const io = fakeIo({
		...base,
		"git remote get-url origin": "git@github.com:alice/cv.git",
		"env GH_TOKEN": "github_pat_session",
	});

	await up(
		{ repo, label: "web-1", root: "/root", memory: "16g", cpus: "8" },
		io,
	);

	const run = io.calls.find((c) => c[0] === "sbx" && c[1] === "run")!;
	assert.ok(!run.includes("--static-mcp"));
	assert.deepEqual(
		[run[run.indexOf("--memory") + 1], run[run.indexOf("--cpus") + 1]],
		["16g", "8"],
	);
	const secret = io.calls
		.filter((c) => c[0] === "sbx")
		.findIndex((c) => c[1] === "secret");
	assert.equal(io.sbxOpts[secret]?.input, "github_pat_session");
	assert.match(
		io.files["/home/me/.sandboxes/webapp/pi-webapp-web-1/permissions.md"],
		/^- resources: 16g memory, 8 cpus$/m,
	);
});

const pushing = {
	...base,
	"read /root/host/repos.json": WITH_PRIVATE,
	"git remote get-url origin": "git@github.com:alice/private-app.git",
	"herdr workspace list": {
		result: { workspaces: [{ workspace_id: "w1", label: "private-app" }] },
	},
	"sbx exec claude-private-app-x git -C /r/private-app rev-parse refs/fleet/base":
		"3".repeat(40),
};
const privateRepos = "sbx exec claude-private-app-x gh api /user/repos";
const fromSession = JSON.stringify({
	...JSON.parse(SAMPLE_PROFILES),
	[PRIVATE_REPO]: {
		...PRIVATE_PROFILE,
		container: { ...PRIVATE_PROFILE.container, token: "env:GH_TOKEN" },
	},
});

test("where the profile takes the container token from the session, up hands it to sbx on stdin and asks the keychain nothing", async () => {
	const io = fakeIo(
		{
			...pushing,
			"read /root/host/repos.json": fromSession,
			[privateRepos]: "alice/private-app",
			"env GH_TOKEN": "github_pat_session",
		},
		SEATS.claude,
	);

	await up({ repo: "/r/private-app", label: "x", root: "/root" }, io);

	const sbx = io.calls.filter((c) => c[0] === "sbx");
	const secret = sbx.findIndex((c) => c[1] === "secret");
	assert.deepEqual(sbx[secret], [
		"sbx",
		"secret",
		"set",
		"github",
		"--sandbox",
		"claude-private-app-x",
	]);
	assert.equal(io.sbxOpts[secret]?.input, "github_pat_session");
	assert.ok(!io.calls.some((c) => c.includes("--command")));
});

test("where the profile names a keychain token, up has sbx read it from the keychain at use time", async () => {
	const io = fakeIo(
		{
			...pushing,
			"read /root/host/repos.json": JSON.stringify({
				...JSON.parse(SAMPLE_PROFILES),
				[PRIVATE_REPO]: {
					...PRIVATE_PROFILE,
					container: { ...PRIVATE_PROFILE.container, token: "keychain:private-app" },
				},
			}),
			[privateRepos]: "alice/private-app",
		},
		SEATS.claude,
	);

	await up({ repo: "/r/private-app", label: "x", root: "/root" }, io);

	const sbx = io.calls.filter((c) => c[0] === "sbx");
	const secret = sbx.findIndex((c) => c[1] === "secret");
	assert.deepEqual(sbx[secret], [
		"sbx",
		"secret",
		"set",
		"github",
		"--sandbox",
		"claude-private-app-x",
		"--command",
		"security find-generic-password -s fleet-gh -a private-app -w",
	]);
	assert.equal(io.sbxOpts[secret]?.input, undefined);
});

test("where the profile takes the container token from the session and the session has none, up stops before creating anything", async () => {
	const io = fakeIo(
		{ ...pushing, "read /root/host/repos.json": fromSession },
		SEATS.claude,
	);

	await assert.rejects(
		up({ repo: "/r/private-app", label: "x", root: "/root" }, io),
		/alice\/private-app takes its container token from GH_TOKEN, and this session has none: start claude with GH_TOKEN set/,
	);
	assert.ok(
		!io.calls.some(
			(c) => c[0] === "sbx" && (c[1] === "run" || c[1] === "secret"),
		),
	);
});

test("where the container may push, up keeps a token that sees this private repository alone", async () => {
	const io = fakeIo(
		{ ...pushing, [privateRepos]: "alice/private-app" },
		SEATS.claude,
	);

	await up({ repo: "/r/private-app", label: "x", root: "/root" }, io);

	assert.ok(io.calls.some((c) => c.join(" ").startsWith(privateRepos)));
	const run = io.calls.find((c) => c[0] === "sbx" && c[1] === "run")!;
	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c[1] === "rm"));
	assert.equal(run[run.indexOf("--memory") + 1], "4g");
});

test("where the container may push, up keeps a token that sees no private repository, as for a public project", async () => {
	const io = fakeIo({ ...pushing, [privateRepos]: "" }, SEATS.claude);

	await up({ repo: "/r/private-app", label: "x", root: "/root" }, io);

	assert.ok(io.calls.some((c) => c.join(" ").startsWith(privateRepos)));
	assert.ok(!io.calls.some((c) => c[0] === "sbx" && c[1] === "rm"));
});

test("where the container may push, up removes the container whose token sees another private repository", async () => {
	const io = fakeIo(
		{ ...pushing, [privateRepos]: "alice/private-app\nalice/diary" },
		SEATS.claude,
	);

	await assert.rejects(
		up({ repo: "/r/private-app", label: "x", root: "/root" }, io),
		/container was removed[\s\S]*no private repository other than alice\/private-app; it sees alice\/private-app, alice\/diary/,
	);
	assert.deepEqual(io.calls.at(-1), ["sbx", "rm", "-f", "claude-private-app-x"]);
	assert.equal(
		io.files[
			"/home/me/.sandboxes/private-app/claude-private-app-x/permissions.md"
		],
		undefined,
	);
});

test("up writes the repository's overlay into the task directory as project.md, and none, not even an earlier one, when it has none", async () => {
	const task = "/home/me/.sandboxes/webapp/pi-webapp-web-1";
	const overlay = "# acme/webapp\n\n## Merge method\n\n--squash\n";
	const io = fakeIo({
		...base,
		"read /home/me/.config/harness/projects/acme/webapp.md": overlay,
	});
	await up({ repo, label: "web-1", root: "/root" }, io);
	assert.equal(io.files[`${task}/project.md`], overlay);

	const none = fakeIo(base);
	await up({ repo, label: "web-1", root: "/root" }, none);
	assert.ok(
		!none.calls.some((c) => c[0] === "write" && c[1] === `${task}/project.md`),
	);
	assert.ok(
		none.calls.some((c) => c[0] === "remove" && c[1] === `${task}/project.md`),
	);
});

test("up runs the overlay's Setup sh block after the install, and the plain install when the overlay has none", async () => {
	const setupOverlay =
		"# acme/webapp\n\n## Setup\n\nPlaywright needs its browsers.\n\n```sh\nnpx playwright install chromium\n```\n\n## Merge method\n\n--squash\n";
	const installOf = async (files: Record<string, unknown>) => {
		const io = fakeIo({ ...files, [containerLocks]: "yarn.lock" });
		await up({ repo, label: "web-1", root: "/root" }, io);
		return String(
			io.calls.find(
				(c) => c[0] === "sbx" && String(c[5]).includes("fleet-install"),
			)![7],
		);
	};
	const plain = await installOf(base);

	const script = await installOf({
		...base,
		"read /home/me/.config/harness/projects/acme/webapp.md": setupOverlay,
	});
	const install = script.indexOf("yarn install");
	const setup = script.indexOf("npx playwright install chromium");
	assert.ok(
		install !== -1 && setup > install,
		"the setup command does not follow the install",
	);
	assert.ok(
		setup < script.indexOf("deps: ready"),
		"the setup command runs after ready is reported",
	);
	assert.doesNotMatch(script, /Playwright needs|--squash/);

	assert.equal(
		await installOf({
			...base,
			"read /home/me/.config/harness/projects/acme/webapp.md":
				"# acme/webapp\n\n## Setup\n\n## Merge method\n\n--squash\n",
		}),
		plain,
	);
});

test("an overlay Setup block runs even where no lockfile installs", async () => {
	const io = fakeIo({
		...base,
		"read /home/me/.config/harness/projects/acme/webapp.md":
			"## Setup\n\n```sh\nlefthook install\n```\n",
	});
	await up({ repo, label: "web-1", root: "/root" }, io);

	const install = io.calls.find(
		(c) => c[0] === "sbx" && String(c[5]).includes("fleet-install"),
	);
	assert.match(String(install?.[7]), /lefthook install/);
});

for (const seat of Object.values(SEATS))
	for (const kind of Object.values(KINDS))
		test(`a ${seat.name} seat puts up a ${kind.name} container and logs it where every seat reads`, async () => {
			const io = fakeIo(base, seat);

			const out = await up(
				{ repo, label: "web-1", root: "/root", branch: "web-1", kind: kind.name },
				io,
			);

			assert.equal(out.sandbox, `${kind.prefix}webapp-web-1`);
			assert.ok(
				io.calls
					.find((c) => c[0] === "sbx" && c[1] === "run")!
					.includes(kind.agentSpec("/root")),
			);
			assert.match(
				io.calls.find((c) => c[1] === "pane")!.at(-1)!,
				new RegExp(`^HERDR_AGENT=${kind.name} `),
			);
			assert.ok(
				io.calls.some(
					(c) =>
						c[0] === "append" &&
						c[1] === "/home/me/.sandboxes/fleet-events.log" &&
						c[2].includes(` up ${out.sandbox} `),
				),
			);
		});

test("up without a kind puts up the seat's own agent", async () => {
	const io = fakeIo(base, SEATS.claude);

	const out = await up(
		{ repo, label: "web-1", root: "/root", branch: "web-1" },
		io,
	);

	assert.equal(out.sandbox, "claude-webapp-web-1");
});
