import assert from "node:assert/strict";
import { test } from "node:test";
import { gitdirOf, parentDir, submodulePaths } from "./submodules.ts";

test("submodule paths come from git submodule status, whatever the state prefix", () => {
	const out = " 1495ab07 packages/pdf-generator (1.1.11-2-g1495ab0)\n+abc123 vendor/x (heads/main)\n-def456 y\n";
	assert.deepEqual(submodulePaths(out), ["packages/pdf-generator", "vendor/x", "y"]);
	assert.deepEqual(submodulePaths(""), []);
});

test("parent directory of a submodule path", () => {
	assert.equal(parentDir("packages/pdf-generator"), "packages");
	assert.equal(parentDir("y"), ".");
});

test("a submodule's git dir sits under the modules of the git dir that holds it", () => {
	assert.equal(gitdirOf("/w/.git/fleet-repos/api.git", "packages/pdf"), "/w/.git/fleet-repos/api.git/modules/packages/pdf");
});
