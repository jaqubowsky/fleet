import assert from "node:assert/strict";
import { test } from "node:test";
import { installScript } from "./deps.ts";

test("install script picks the frozen install per lockfile and invents no env of its own", () => {
	assert.match(installScript, /pnpm install --frozen-lockfile/);
	assert.match(installScript, /npm ci/);
	assert.match(installScript, /yarn install --immutable/);
	assert.match(installScript, /yarn install --frozen-lockfile/);
	assert.doesNotMatch(installScript, /\\\$/);
	assert.doesNotMatch(installScript, /\.example/);
});
