import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProfiles } from "../profile/profile.ts";
import { syncTokens, tokenFor, tokenRefs } from "./tokens.ts";

function entry(token: string) {
	return {
		host: { sign: "human", push: "human", pr: "none", merge: "none", down: "human", linear: "none" },
		container: { push: "none", pr: "auto", linear: "none", token },
		resources: { memory: "8g", cpus: "4" },
	};
}

const profiles = parseProfiles(
	JSON.stringify({
		"*": entry("op://Personal/GitHub PAT SELF/token"),
		"acme/*": entry("op://Work/GitHub PAT acme/credential"),
		"acme/api": entry("op://Work/GitHub PAT acme/credential"),
		"solo/app": entry("env:GH_TOKEN"),
	}),
);

function keychain(stored: Record<string, string> = {}) {
	return {
		stored,
		read: (ref: string) => stored[ref],
		write: (ref: string, value: string) => {
			stored[ref] = value;
		},
	};
}

const origin = (repo: string) => () => `git@github.com:${repo}.git`;

test("a repository gets the token its profile references, read from the keychain", () => {
	const store = keychain({ "op://Work/GitHub PAT acme/credential": "acme-token" });

	const token = tokenFor(["pr", "checks", "1"], origin("acme/web"), profiles, store);

	assert.equal(token, "acme-token");
});

test("a --repo flag picks the profile over the checkout's origin", () => {
	const store = keychain({
		"op://Personal/GitHub PAT SELF/token": "self-token",
		"op://Work/GitHub PAT acme/credential": "acme-token",
	});

	assert.equal(tokenFor(["pr", "view", "--repo", "acme/api"], origin("me/fleet"), profiles, store), "acme-token");
	assert.equal(tokenFor(["pr", "view", "-R", "acme/api"], origin("me/fleet"), profiles, store), "acme-token");
	assert.equal(tokenFor(["pr", "view", "--repo=acme/api"], origin("me/fleet"), profiles, store), "acme-token");
});

test("a profile with an environment token, or a reference not yet copied, leaves gh to its own login", () => {
	const store = keychain();

	assert.equal(tokenFor(["pr", "list"], origin("solo/app"), profiles, store), undefined);
	assert.equal(tokenFor(["pr", "list"], origin("acme/web"), profiles, store), undefined);
});

test("outside a checkout the catch-all profile answers", () => {
	const store = keychain({ "op://Personal/GitHub PAT SELF/token": "self-token" });

	const token = tokenFor(["api", "user"], () => "", profiles, store);

	assert.equal(token, "self-token");
});

test("sync copies each 1Password reference once into the keychain and names what it copied", () => {
	const store = keychain();
	const read: string[] = [];

	const lines = syncTokens(profiles, (ref) => {
		read.push(ref);
		return `${ref.split("/")[3]}-value`;
	}, store);

	assert.deepEqual(tokenRefs(profiles), ["op://Personal/GitHub PAT SELF/token", "op://Work/GitHub PAT acme/credential"]);
	assert.deepEqual(read, tokenRefs(profiles));
	assert.deepEqual(store.stored, {
		"op://Personal/GitHub PAT SELF/token": "GitHub PAT SELF-value",
		"op://Work/GitHub PAT acme/credential": "GitHub PAT acme-value",
	});
	assert.deepEqual(lines, [
		"copied op://Personal/GitHub PAT SELF/token",
		"copied op://Work/GitHub PAT acme/credential",
	]);
});
