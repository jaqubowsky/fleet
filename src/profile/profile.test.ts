import assert from "node:assert/strict";
import { test } from "node:test";
import { PRIVATE_PROFILE, PRIVATE_REPO, REAL_PROFILES, WITH_PRIVATE } from "./fixture.ts";
import { describe, parseProfiles, profileFor, repoName } from "./profile.ts";

const star = JSON.parse(REAL_PROFILES)["*"];

test("an exact repository beats its owner, the owner beats *, and an unknown repository gets *", () => {
	const profiles = parseProfiles(JSON.stringify({ "*": star, "acme/*": PRIVATE_PROFILE, "Acme/Special": { ...PRIVATE_PROFILE, resources: { memory: "2g", cpus: "1" } } }));

	assert.equal(profileFor(profiles, "acme/special").resources.memory, "2g");
	assert.equal(profileFor(profiles, "ACME/other").match, "acme/*");
	assert.equal(profileFor(profiles, "someone/else").match, "*");
	assert.equal(profileFor(profiles, "").match, "*");
});

test("the repository comes from any GitHub origin spelling, and nothing from another host", () => {
	assert.equal(repoName("git@github.com:acme/webapp.git"), "acme/webapp");
	assert.equal(repoName("git@github.com-work:globex/x.git"), "globex/x");
	assert.equal(repoName("https://github.com/bob/y"), "bob/y");
	assert.equal(repoName("https://github.com/alice/harness.git/"), "alice/harness");
	assert.equal(repoName("git@gitlab.com:a/b.git"), "");
	assert.equal(repoName(""), "");
});

const refused = (change: (entry: typeof PRIVATE_PROFILE & Record<string, unknown>) => unknown, pattern: RegExp) => {
	const entry = structuredClone(PRIVATE_PROFILE) as typeof PRIVATE_PROFILE & Record<string, unknown>;
	change(entry);
	assert.throws(() => parseProfiles(JSON.stringify({ "*": star, [PRIVATE_REPO]: entry })), pattern);
};

test("a profile file that breaks the contract is refused with the field it breaks", () => {
	refused((e) => { e.host.push = "sometimes"; }, /private-app\.host\.push is "sometimes"; it takes none, human, auto/);
	refused((e) => { (e.host as Record<string, unknown>).deploy = "auto"; }, /host\.deploy is not a field/);
	refused((e) => { (e.container as Record<string, unknown>).merge = "none"; }, /container\.merge: containers never merge/);
	refused((e) => { delete (e.container as Record<string, unknown>).linearServer; }, /container\.linearServer is missing/);
	refused((e) => { e.host.linear = "none"; }, /host\.linearServer is not a field/);
	refused((e) => { e.host.sign = "human"; }, /host\.sign human cannot go with container\.push auto/);
	refused((e) => { delete (e as Record<string, unknown>).resources; }, /resources is missing/);
	assert.throws(() => parseProfiles(JSON.stringify({ [PRIVATE_REPO]: PRIVATE_PROFILE })), /no \* entry/);
	assert.throws(() => parseProfiles(JSON.stringify({ "*": star, "a/b/c": star })), /a match is owner\/repo, owner\/\* or \*/);
	assert.throws(() => parseProfiles(JSON.stringify({ "*": star, "Acme/*": star, "acme/*": star })), /repeats Acme\/\*/);
	assert.throws(() => parseProfiles('{ "*": {},, }'), /^Error: host\/repos\.json: /);
});

test("the profile file holds today's three profiles", () => {
	const profiles = parseProfiles(REAL_PROFILES);
	const webapp = profileFor(profiles, "acme/webapp");
	const globex = [profileFor(profiles, "globex/x"), profileFor(profiles, "bob/y")];
	const personal = profileFor(profiles, "alice/cv");

	assert.deepEqual(webapp.host, { sign: "none", push: "human", pr: "none", merge: "none", linear: "none" });
	assert.deepEqual(webapp.container, { push: "none", pr: "auto", linear: "read", linearServer: "linear-acme-readonly", token: "op://Dev/GitHub PAT webapp/credential" });
	for (const profile of [...globex, personal]) {
		assert.deepEqual(profile.host, { sign: "human", push: "human", pr: "none", merge: "none", linear: "none" });
		assert.deepEqual({ ...profile.container, token: undefined }, { push: "none", pr: "auto", linear: "none", token: undefined });
	}
	assert.deepEqual(globex.map((p) => p.container.token), ["op://Dev/GitHub PAT globex/credential", "op://Dev/GitHub PAT globex/credential"]);
	assert.equal(personal.container.token, "op://Dev/GitHub PAT Personal/credential");
	assert.deepEqual(new Set(Object.values(profiles).map((p) => p.resources.memory)), new Set(["8g"]));
});

test("the description gives each seat one line per action, with its level and what it means there", () => {
	const text = describe(PRIVATE_REPO, profileFor(parseProfiles(WITH_PRIVATE), PRIVATE_REPO), "cfleet");
	const [container, host] = text.split("## Host");

	assert.match(text, /^# Permissions: alice\/private-app\n/);
	assert.match(container, /^- push `auto`: push your own branch to origin, never forced$/m);
	assert.match(container, /^- merge `none`: containers never merge$/m);
	assert.match(container, /^- linear `read`: read Linear through `linear-private-readonly`; nothing can be written there$/m);
	assert.match(container, /^- resources: 4g memory, 4 cpus$/m);
	assert.match(host, /^- sign `none`: commits stay unsigned; `cfleet land` signs only with --sign$/m);
	assert.match(host, /^- push `auto`: push with `git push`, never forced; the guard allows it$/m);
	assert.match(host, /^- merge `auto`: merge an accepted pull request with `gh pr merge`; the guard allows it$/m);
	assert.match(host, /^- linear `write`: read and write Linear through `linear-private`/m);
	assert.deepEqual(text.match(/^- \w+/gm), ["- push", "- pr", "- merge", "- linear", "- resources", "- sign", "- push", "- pr", "- merge", "- linear"]);
});
