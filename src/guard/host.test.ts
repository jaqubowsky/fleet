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

test("a second remote or a gh default repository takes pull requests away from the host", () => {
	const upstream = checkout(own);
	execFileSync("git", ["-C", upstream, "remote", "add", "upstream", "git@github.com:acme/webapp.git"]);
	const resolved = checkout(own);
	execFileSync("git", ["-C", resolved, "config", "remote.origin.gh-resolved", "acme/webapp"]);

	for (const dir of [upstream, resolved]) {
		const levels = hostAt(dir, privateRoot()).levels();

		assert.deepEqual([levels.push, levels.pr, levels.merge], ["auto", "none", "none"], dir);
	}
});
