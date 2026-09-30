import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pushRefusal } from "./container.ts";
import containerGuard from "../../extensions/container-guard.ts";

function clone(branch: string, base = "main"): string {
	const dir = mkdtempSync(join(tmpdir(), "container-clone-"));
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", dir, ...args], {
			stdio: ["ignore", "pipe", "ignore"],
		});
	git("init", "--quiet", "--initial-branch", base);
	git(
		"-c",
		"user.name=t",
		"-c",
		"user.email=t@t",
		"commit",
		"--quiet",
		"--allow-empty",
		"-m",
		"seed",
	);
	git("remote", "add", "origin", "https://github.com/owner/repo.git");
	git("update-ref", `refs/remotes/origin/${base}`, "HEAD");
	git("symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${base}`);
	if (branch !== base) git("switch", "--quiet", "-c", branch);
	return dir;
}

test("in a container on its own branch, a push to origin's default branch is refused in any spelling", () => {
	const dir = clone("web-1");

	for (const command of [
		"git push origin main",
		"git push -u origin main",
		"git push origin HEAD:main",
		"git push origin web-1:refs/heads/main",
		"git push origin +main",
		"git push origin :main",
		"git push --all origin",
		"git push origin 'refs/heads/*:refs/heads/*'",
		"git -C . push origin main",
		"cd . && git push origin main",
		'bash -c "git push origin main"',
		"git push --repo origin main",
		"sudo -u agent git push origin main",
		"timeout 60 git push origin main",
		"nohup nice -n 5 git push origin main",
	])
		assert.match(pushRefusal(command, dir) ?? "", /default branch main/, command);
});

test("in a container on its own branch, a push of that branch and every other command pass", () => {
	const dir = clone("web-1");

	for (const command of [
		"git push",
		"git push origin",
		"git push -u origin web-1",
		"git push origin HEAD",
		"git push -o ci.skip origin web-1",
		'git commit -m "git push origin main"',
		"git log main",
		"ls",
	])
		assert.equal(pushRefusal(command, dir), undefined, command);
});

test("a push the guard cannot place, because the same command moves HEAD, changes config or computes the target, is refused", () => {
	const dir = clone("web-1");

	for (const command of [
		"git switch main && git push",
		"git checkout main; git push origin HEAD",
		"git config push.default upstream && git push",
		"git -c remote.origin.push=HEAD:refs/heads/main push origin",
		"git push origin $(echo main)",
		"git push origin \x60echo main\x60",
		'B=main; git push origin "$B"',
		"echo main | xargs git push origin",
	])
		assert.match(
			pushRefusal(command, dir) ?? "",
			/cannot tell where this push goes/,
			command,
		);
	assert.match(
		pushRefusal("git push origin HEAD:heads/main", dir) ?? "",
		/default branch main/,
	);
});

test("a push that names no branch goes where git config sends it, so a branch tracking the default branch cannot reach it", () => {
	const dir = clone("web-1");
	execFileSync("git", ["-C", dir, "branch", "--set-upstream-to", "origin/main"]);
	execFileSync("git", ["-C", dir, "config", "push.default", "upstream"]);

	assert.match(pushRefusal("git push", dir) ?? "", /default branch main/);
	assert.match(pushRefusal("git push origin", dir) ?? "", /default branch main/);
});

test("a container on the default branch cannot push it by naming no branch", () => {
	const dir = clone("main");

	for (const command of [
		"git push",
		"git push origin",
		"git push -u origin HEAD",
	])
		assert.match(pushRefusal(command, dir) ?? "", /default branch main/, command);
});

test("the default branch is the one origin/HEAD names, not a fixed name", () => {
	const dir = clone("web-1", "develop");

	assert.match(
		pushRefusal("git push origin develop", dir) ?? "",
		/default branch develop/,
	);
	assert.equal(pushRefusal("git push origin main", dir), undefined);
});

test("a clone without origin/HEAD refuses every push, since it cannot tell the default branch", () => {
	const dir = clone("web-1");
	execFileSync("git", [
		"-C",
		dir,
		"symbolic-ref",
		"--delete",
		"refs/remotes/origin/HEAD",
	]);

	assert.match(pushRefusal("git push origin web-1", dir) ?? "", /origin\/HEAD/);
	assert.equal(pushRefusal("git status", dir), undefined);
});

test("the claude container hook denies a push to the default branch and stays silent on the own branch", (t) => {
	const dir = clone("web-1");
	const task = mkdtempSync(join(tmpdir(), "container-task-"));
	const hook = (command: string, multi = false) =>
		execFileSync(
			process.execPath,
			[
				join(import.meta.dirname, "../../claude/hooks/container.ts"),
				"pre-tool-use",
			],
			{
				input: JSON.stringify({
					tool_name: "Bash",
					tool_input: { command },
					cwd: dir,
				}),
				env: {
					...process.env,
					FLEET_ARTIFACTS: task,
					SANDBOX_NAME: "claude-a",
					FLEET_REPOSITORIES: multi ? "3" : "",
				},
				encoding: "utf8",
			},
		);

	const denied = JSON.parse(hook("git push origin main")).hookSpecificOutput;

	assert.equal(denied.permissionDecision, "deny");
	assert.match(denied.permissionDecisionReason, /default branch main/);
	assert.equal(hook("git push -u origin web-1"), "");
	mkdirSync(join(task, "claude-a"));
	writeFileSync(join(task, "claude-a/repositories.json"), "{}");
	t.after(() => rmSync(task, { recursive: true, force: true }));
	assert.match(hook("git push -u origin web-1", true), /pushes.*host/);
	rmSync(join(task, "claude-a/repositories.json"));
	assert.match(hook("git push -u origin web-1", true), /pushes.*host/);
});

test("the claude container hook denies the call when the guard itself fails, instead of letting it run", () => {
	const task = mkdtempSync(join(tmpdir(), "container-task-"));
	const out = execFileSync(
		process.execPath,
		[
			join(import.meta.dirname, "../../claude/hooks/container.ts"),
			"pre-tool-use",
		],
		{
			input: "not json",
			env: { ...process.env, FLEET_ARTIFACTS: task, SANDBOX_NAME: "claude-a" },
			encoding: "utf8",
		},
	);

	const denied = JSON.parse(out).hookSpecificOutput;
	assert.equal(denied.permissionDecision, "deny");
	assert.match(denied.permissionDecisionReason, /container guard failed/);
});

test("the pi container extension blocks a push to the default branch, only inside a container", (t) => {
	const dir = clone("web-1");
	const handlerOf = (env: Record<string, string | undefined>) => {
		const saved = {
			FLEET_ARTIFACTS: process.env.FLEET_ARTIFACTS,
			SANDBOX_NAME: process.env.SANDBOX_NAME,
			FLEET_REPOSITORIES: process.env.FLEET_REPOSITORIES,
		};
		Object.assign(process.env, env);
		for (const [key, value] of Object.entries(env))
			if (value === undefined) delete process.env[key];
		let handler:
			| ((
					event: { toolName: string; input?: Record<string, unknown> },
					ctx: { cwd: string },
			  ) => unknown)
			| undefined;
		try {
			containerGuard({
				on: (_event: string, fn: typeof handler) => (handler = fn),
			});
		} finally {
			for (const [key, value] of Object.entries(saved))
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
		}
		return handler;
	};

	const inside = handlerOf({ FLEET_ARTIFACTS: "/tmp/x", SANDBOX_NAME: "pi-a" });

	assert.match(
		(
			inside?.(
				{ toolName: "bash", input: { command: "git push origin main" } },
				{ cwd: dir },
			) as { reason: string }
		).reason,
		/default branch main/,
	);
	assert.equal(
		inside?.(
			{ toolName: "bash", input: { command: "git push origin web-1" } },
			{ cwd: dir },
		),
		undefined,
	);
	assert.equal(
		inside?.({ toolName: "read", input: { path: "a" } }, { cwd: dir }),
		undefined,
	);
	assert.equal(
		handlerOf({ FLEET_ARTIFACTS: undefined, SANDBOX_NAME: undefined }),
		undefined,
	);
	const task = mkdtempSync(join(tmpdir(), "two-repos-task-"));
	mkdirSync(join(task, "pi-a"));
	writeFileSync(join(task, "pi-a/repositories.json"), "{}");
	t.after(() => rmSync(task, { recursive: true, force: true }));
	const multi = handlerOf({
		FLEET_ARTIFACTS: task,
		SANDBOX_NAME: "pi-a",
		FLEET_REPOSITORIES: "3",
	});
	assert.match(
		(
			multi?.(
				{ toolName: "bash", input: { command: "git push origin web-1" } },
				{ cwd: dir },
			) as { reason?: string } | undefined
		)?.reason ?? "",
		/pushes.*host/,
	);
	rmSync(join(task, "pi-a/repositories.json"));
	const revived = handlerOf({
		FLEET_ARTIFACTS: task,
		SANDBOX_NAME: "pi-a",
		FLEET_REPOSITORIES: "3",
	});
	assert.match(
		(
			revived?.(
				{ toolName: "bash", input: { command: "git push origin web-1" } },
				{ cwd: dir },
			) as { reason?: string } | undefined
		)?.reason ?? "",
		/pushes.*host/,
	);
});
