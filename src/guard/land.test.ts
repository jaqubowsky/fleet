import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { landPermission, sandboxLandStanding } from "./land.ts";

function workspaces(t: { after(fn: () => void): void }) {
	const home = mkdtempSync(join(tmpdir(), "land-standing-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	mkdirSync(join(home, ".fleet/config/projects/alice"), { recursive: true });
	writeFileSync(
		join(home, ".fleet/config/projects/alice/autonomous.md"),
		"# alice/autonomous\n\n## Host autonomy\n\nThe person, 2026-11-09: \"land it\".\n",
	);
	writeFileSync(
		join(home, ".fleet/config/projects/alice/plain.md"),
		"# alice/plain\n\n## Merge method\n\nThe host autonomy of this repo is none.\n",
	);
	const sandboxes = ["autonomous", "plain", "missing"].map((repo) => {
		const workspace = join(home, repo);
		execFileSync("git", ["init", "--quiet", workspace]);
		execFileSync("git", ["-C", workspace, "remote", "add", "origin", `git@github.com:alice/${repo}.git`]);
		return { name: `claude-${repo}`, workspaces: [workspace] };
	});
	const list = () => JSON.stringify(sandboxes);
	return { home, sandboxes, standing: (sandbox: string) => sandboxLandStanding(sandbox, home, list) };
}

test("land goes ahead without asking when the overlay holds the standing word", (t) => {
	const { standing } = workspaces(t);

	const verdict = landPermission("fleet land claude-autonomous", standing);

	assert.equal(verdict?.decision, "allow");
	assert.match(verdict?.reason ?? "", /Host autonomy/);
});

test("land still asks in a repository without the standing word", (t) => {
	const { standing } = workspaces(t);

	for (const sandbox of ["claude-plain", "claude-missing", "claude-unknown"])
		assert.equal(landPermission(`fleet land ${sandbox} --push`, standing)?.decision, "ask", sandbox);
});

test("land asks when one repository of a multi-repository sandbox lacks the standing word", (t) => {
	const { home, sandboxes, standing } = workspaces(t);
	mkdirSync(join(home, ".fleet/config/fleet"), { recursive: true });
	writeFileSync(
		join(home, ".fleet/config/fleet/claude-autonomous.json"),
		JSON.stringify({
			version: 1,
			task: join(home, ".fleet/tasks/autonomous/claude-autonomous"),
			repositories: sandboxes.slice(0, 2).map((entry) => ({
				repo: entry.workspaces[0],
				name: `alice/${entry.name.slice(7)}`,
				base: "main",
				baseSha: "1".repeat(40),
				branch: "task",
				workspace: entry.workspaces[0],
				served: "",
			})),
		}),
	);

	assert.equal(landPermission("fleet land claude-autonomous", standing)?.decision, "ask");
});

test("land asks when the standing word cannot be read", () => {
	const verdict = landPermission("fleet land claude-autonomous", () => {
		throw new Error("spawnSync sbx ETIMEDOUT");
	});

	assert.equal(verdict?.decision, "ask");
});

test("land with the standing word must still be bare", (t) => {
	const { standing } = workspaces(t);

	assert.equal(landPermission("fleet land claude-autonomous && git push", standing)?.decision, "deny");
});
