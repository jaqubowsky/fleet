import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { agentName } from "../fleet/name.ts";
import { PRIVATE_PROFILE, REPO_PROFILES } from "../profile/fixture.ts";
import { downPermission, sandboxDownTarget } from "./down.ts";

test("down follows the target sandbox's level, not the caller's checkout", () => {
	const level = (name: string) => ({
		sandbox: name,
		level:
			name === "claude-landing-demo"
				? ("auto" as const)
				: name === "pi-harness-demo"
					? ("human" as const)
					: ("none" as const),
	});

	assert.equal(
		downPermission("fleet down claude-landing-demo", level)?.decision,
		"allow",
	);
	assert.deepEqual(downPermission("fleet down pi-harness-demo", level), {
		decision: "ask",
		reason: "Ask the person before closing pi-harness-demo.",
		sandbox: "pi-harness-demo",
	});
	assert.match(
		downPermission("fleet down pi-other-demo", level)?.reason ?? "",
		/leaves fleet down to the person/,
	);
	assert.equal(
		downPermission("fleet down pi-harness-demo", () => undefined)?.decision,
		"deny",
	);
});

test("down reads the target workspace profile instead of the host checkout", (t) => {
	const root = mkdtempSync(join(tmpdir(), "down-profile-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, "host"));
	const profiles = JSON.parse(REPO_PROFILES);
	profiles["alice/auto"] = {
		...PRIVATE_PROFILE,
		host: { ...PRIVATE_PROFILE.host, down: "auto" },
	};
	profiles["alice/none"] = {
		...PRIVATE_PROFILE,
		host: { ...PRIVATE_PROFILE.host, down: "none" },
	};
	writeFileSync(join(root, "host/repos.json"), JSON.stringify(profiles));
	const sandboxes = ["human", "auto", "none"].map((level) => {
		const workspace = join(root, level);
		execFileSync("git", ["init", "--quiet", workspace]);
		execFileSync("git", [
			"-C",
			workspace,
			"remote",
			"add",
			"origin",
			`git@github.com:alice/${level}.git`,
		]);
		return { name: `pi-${level}`, workspaces: [workspace] };
	});
	const list = () => JSON.stringify({ sandboxes });

	assert.deepEqual(sandboxDownTarget("pi-human", root, root, list), {
		sandbox: "pi-human",
		level: "human",
	});
	assert.deepEqual(sandboxDownTarget("pi-auto", root, root, list), {
		sandbox: "pi-auto",
		level: "auto",
	});
	assert.deepEqual(sandboxDownTarget("pi-none", root, root, list), {
		sandbox: "pi-none",
		level: "none",
	});
	assert.equal(sandboxDownTarget("pi-missing", root, root, list), undefined);
	mkdirSync(join(root, ".fleet/config/fleet"), { recursive: true });
	writeFileSync(
		join(root, ".fleet/config/fleet/pi-auto.json"),
		JSON.stringify({
			version: 1,
			repositories: [sandboxes[1], sandboxes[0], sandboxes[2]].map((entry) => ({
				repo: entry.workspaces[0],
				name: `alice/${entry.name.slice(3)}`,
				base: "main",
				baseSha: "1".repeat(40),
				branch: "task",
				workspace: entry.workspaces[0],
				served: "",
			})),
		}),
	);
	assert.deepEqual(sandboxDownTarget("pi-auto", root, root, list), {
		sandbox: "pi-auto",
		level: "none",
	});
	const longName = "pi-harness-a-long-container-name-that-herdr-shortens";
	const shortened = agentName(longName);
	assert.notEqual(shortened, longName);
	const target = sandboxDownTarget(shortened, root, root, () =>
		JSON.stringify({
			sandboxes: [{ name: longName, workspaces: [sandboxes[1].workspaces[0]] }],
		}),
	);
	assert.deepEqual(target, { sandbox: longName, level: "auto" });
	assert.match(
		downPermission(`fleet down ${shortened}`, () => ({
			sandbox: longName,
			level: "human",
		}))?.reason ?? "",
		new RegExp(longName),
	);
});

test("down must name one sandbox in a bare command regardless of its level", () => {
	const level = (sandbox: string) => ({ sandbox, level: "auto" as const });
	for (const command of [
		"fleet down x | tail",
		"cd /r && fleet down x",
		"bash -c 'fleet down x'",
		"env fleet down x",
		"/usr/local/bin/fleet down x",
		"fleet down $NAME",
		"fleet down x --force --force",
		"fleet down",
	]) {
		assert.equal(downPermission(command, level)?.decision, "deny", command);
	}
	assert.equal(downPermission("fleet down x --force", level)?.decision, "deny");
	assert.equal(downPermission("fleet down --force x", level)?.decision, "deny");
	assert.equal(
		downPermission(`sh -c 'exec "$@"' -- fleet down x`, level)?.decision,
		"deny",
	);
	assert.equal(downPermission("echo 'fleet down x'", level), undefined);
});
