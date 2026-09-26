import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { PRIVATE_REPO } from "../profile/fixture.ts";
import { checkout, privateRoot } from "./checkouts.ts";
import { hostAt } from "./host.ts";

const own = `git@github.com:${PRIVATE_REPO}.git`;

test("a checkout whose only remote is origin takes the host levels of origin's profile", () => {
	const levels = hostAt(checkout(own), privateRoot()).levels();

	assert.deepEqual([levels.push, levels.pr, levels.merge], ["auto", "auto", "auto"]);
});

test("a local sandbox remote beside origin leaves the host its pull requests", () => {
	const dir = checkout(own);
	execFileSync("git", ["-C", dir, "remote", "add", "sandbox-claude-x-t08", "git://127.0.0.1:49170/x"]);

	const levels = hostAt(dir, privateRoot()).levels();

	assert.deepEqual([levels.push, levels.pr, levels.merge], ["auto", "auto", "auto"]);
});

test("a second GitHub remote under any name or a gh default repository takes pull requests away from the host", () => {
	const upstream = checkout(own);
	execFileSync("git", ["-C", upstream, "remote", "add", "upstream", "git@github.com:acme/webapp.git"]);
	const sandboxNamed = checkout(own);
	execFileSync("git", ["-C", sandboxNamed, "remote", "add", "sandbox-x", "https://github.com/other/repo"]);
	const dotted = checkout(own);
	execFileSync("git", ["-C", dotted, "remote", "add", "origin.x", "https://github.com/other/repo"]);
	const pushesToGitHub = checkout(own);
	execFileSync("git", ["-C", pushesToGitHub, "remote", "add", "sandbox-y", "git://127.0.0.1:49170/x"]);
	execFileSync("git", ["-C", pushesToGitHub, "remote", "set-url", "--push", "sandbox-y", "https://github.com/other/repo"]);
	const resolved = checkout(own);
	execFileSync("git", ["-C", resolved, "config", "remote.origin.gh-resolved", "acme/webapp"]);

	for (const dir of [upstream, sandboxNamed, dotted, pushesToGitHub, resolved]) {
		const levels = hostAt(dir, privateRoot()).levels();

		assert.deepEqual([levels.push, levels.pr, levels.merge], ["auto", "none", "none"], dir);
	}
});
