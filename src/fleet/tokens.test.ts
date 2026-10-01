import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProfiles } from "../profile/profile.ts";
import { listTokens, setToken, tokenFor } from "./tokens.ts";

function entry(token: string) {
	return {
		host: { sign: "human", push: "human", pr: "none", merge: "none", down: "human", linear: "none" },
		container: { push: "none", pr: "auto", linear: "none", token },
		resources: { memory: "8g", cpus: "4" },
	};
}

const profiles = parseProfiles(
	JSON.stringify({
		"*": entry("keychain:self"),
		"acme/*": entry("keychain:acme"),
		"acme/api": entry("keychain:acme"),
		"solo/app": entry("env:GH_TOKEN"),
	}),
);

function keychain(stored: Record<string, string> = {}) {
	return {
		stored,
		has: (name: string) => name in stored,
		read: (name: string) => stored[name],
		write: (name: string, value: string) => {
			stored[name] = value;
		},
	};
}

const origin = (repo: string) => () => `git@github.com:${repo}.git`;

test("a repository gets the token its profile names, read from the keychain", () => {
	const store = keychain({ acme: "acme-token" });

	const token = tokenFor(["pr", "checks", "1"], origin("acme/web"), profiles, store);

	assert.equal(token, "acme-token");
});

test("a --repo flag picks the profile over the checkout's origin", () => {
	const store = keychain({ self: "self-token", acme: "acme-token" });

	assert.equal(tokenFor(["pr", "view", "--repo", "acme/api"], origin("me/fleet"), profiles, store), "acme-token");
	assert.equal(tokenFor(["pr", "view", "-R", "acme/api"], origin("me/fleet"), profiles, store), "acme-token");
	assert.equal(tokenFor(["pr", "view", "--repo=acme/api"], origin("me/fleet"), profiles, store), "acme-token");
});

test("a profile with an environment token, or a name not yet stored, leaves gh to its own login", () => {
	const store = keychain();

	assert.equal(tokenFor(["pr", "list"], origin("solo/app"), profiles, store), undefined);
	assert.equal(tokenFor(["pr", "list"], origin("acme/web"), profiles, store), undefined);
});

test("outside a checkout the catch-all profile answers", () => {
	const store = keychain({ self: "self-token" });

	const token = tokenFor(["api", "user"], () => "", profiles, store);

	assert.equal(token, "self-token");
});

test("the listing names each keychain token once and marks the ones not stored, never printing a value", () => {
	const store = keychain({ self: "self-token" });

	const lines = listTokens(profiles, store);

	assert.deepEqual(lines, ["keychain:acme  missing: fleet tokens set acme", "keychain:self  stored"]);
});

test("a profile set that names no keychain token says so", () => {
	const lines = listTokens(parseProfiles(JSON.stringify({ "*": entry("env:GH_TOKEN") })), keychain());

	assert.deepEqual(lines, ["no profile names a keychain:<name> token"]);
});

test("set stores the token under its name", () => {
	const store = keychain();

	const line = setToken("acme", () => "github_pat_abc\n", store);

	assert.deepEqual(store.stored, { acme: "github_pat_abc" });
	assert.equal(line, "stored keychain:acme");
});

test("set refuses a name a profile could not use, and a value the keychain's command line would misread", () => {
	const store = keychain();

	assert.throws(() => setToken("Acme PAT", () => "github_pat_abc", store), /\^\[a-z0-9\]\[a-z0-9-\]\*\$/);
	assert.throws(() => setToken("acme", () => 'github"pat', store), /a quote or a line break/);
	assert.throws(() => setToken("acme", () => "github\npat", store), /a quote or a line break/);
	assert.throws(() => setToken("acme", () => "", store), /empty/);
	assert.deepEqual(store.stored, {});
});
