import assert from "node:assert/strict";
import { test } from "node:test";
import { installScript } from "./deps.ts";

test("install script picks the frozen install per lockfile and seeds env files first", () => {
	assert.match(installScript, /pnpm install --frozen-lockfile/);
	assert.match(installScript, /npm ci/);
	assert.match(installScript, /yarn install --immutable/);
	assert.match(installScript, /yarn install --frozen-lockfile/);
	assert.match(installScript, /"\$\{e%\.example\}"/);
	assert.doesNotMatch(installScript, /\\\$/);
	assert.ok(installScript.indexOf(".env") < installScript.indexOf("find ."), "env files are seeded before any install can fail");
});
