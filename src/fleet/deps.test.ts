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

test("install script runs a declared generator before it reports ready", () => {
	const generate = installScript.indexOf("prisma:generate");
	const ready = installScript.indexOf("echo deps: ready");

	assert.ok(generate !== -1, "the script runs no code generation");
	assert.ok(generate < ready, "code generation runs after the script reports ready");
	assert.match(installScript, /npm run/);
	assert.match(installScript, /codegen/);
});

test("install script typechecks the base once into the shared cache, after it reports ready", () => {
	const ready = installScript.indexOf("echo deps: ready");
	const gate = installScript.indexOf("npm run typecheck");

	assert.ok(gate > ready, "the base typecheck must not hold up deps: ready");
	assert.match(installScript, /FLEET_CACHE[^\n]*\/gate\//);
	assert.match(installScript, /typecheck\.exit/);
	assert.match(installScript, /merge-base HEAD/);
});
