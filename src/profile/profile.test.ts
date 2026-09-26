import assert from "node:assert/strict";
import { test } from "node:test";
import { PRIVATE_PROFILE, PRIVATE_REPO, REAL_PROFILES, WITH_PRIVATE } from "./fixture.ts";
import { describe, hostLinearServers, parseProfiles, profileFor, repoName } from "./profile.ts";

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
	assert.equal(webapp.resources.memory, "12g");
	assert.deepEqual([...globex, personal].map((p) => p.resources.memory), ["8g", "8g", "8g"]);
});

test("the description gives each seat one line per action, with its level and what it means there", () => {
	const text = describe(PRIVATE_REPO, profileFor(parseProfiles(WITH_PRIVATE), PRIVATE_REPO), "cfleet");
	const [container, host] = text.split("## Host");

	assert.match(text, /^# Permissions: alice\/private-app\n/);
	assert.match(container, /^- push `auto`: push your own branch to origin, never forced/m);
	assert.match(container, /^- merge `none`: containers never merge$/m);
	assert.match(container, /^- linear `read`: read Linear through `linear-private-readonly`; nothing can be written there$/m);
	assert.match(container, /^- resources: 4g memory, 4 cpus$/m);
	assert.match(host, /^- sign `none`: commits stay unsigned; `cfleet land` signs only with --sign$/m);
	assert.match(host, /^- push `auto`: push with `git push`, never forced; the guard allows it/m);
	assert.match(host, /^- merge `auto`: merge an accepted pull request with `gh pr merge`; the guard allows it$/m);
	assert.match(host, /^- linear `write`: read and write Linear through `linear-private`/m);
	assert.deepEqual(text.match(/^- \w+/gm), ["- push", "- pr", "- merge", "- linear", "- resources", "- sign", "- push", "- pr", "- merge", "- linear", "- land"]);
});

test("the description carries each sentence a seat would otherwise choose by level", () => {
	const seats = (container: Record<string, string>, host: Record<string, string> = {}) => {
		const profiles = parseProfiles(JSON.stringify({ "*": { ...star, host: { ...star.host, ...host }, container: { ...star.container, ...container } } }));
		const [inside, outside] = describe("acme/app", profileFor(profiles, "acme/app"), "cfleet").split("## Host");
		return { inside, outside };
	};
	const [ownInside, ownHost] = describe(PRIVATE_REPO, profileFor(parseProfiles(WITH_PRIVATE), PRIVATE_REPO), "cfleet").split("## Host");

	const none = seats({});
	const human = seats({ push: "human" });
	const hostless = seats({}, { push: "none" });

	assert.match(none.inside, /^- push `none`: no credential here pushes; the host lands, signs and pushes the branch, and a steer tells you once it is on GitHub$/m);
	assert.match(human.inside, /^- push `human`: prepare the branch and ask for the push under `attention:`; the person pushes it, and a steer tells you once it is on GitHub$/m);
	assert.match(ownInside, /^- push `auto`: push your own branch to origin, never forced, before `ready-for-host` and at the end of each pull request round$/m);
	assert.match(ownInside, /^- linear `read`: read Linear through `linear-private-readonly`; nothing can be written there$/m);
	assert.match(ownHost, /^- linear `write`: read and write Linear through `linear-private`; write only what you were told to, and say what you posted$/m);
	assert.match(ownHost, /^- push `auto`: push with `git push`, never forced; the guard allows it, and `cfleet profile --apply` keeps the origin on HTTPS with no branch tracking$/m);
	for (const { outside } of [none, human]) assert.match(outside, /^- land: `cfleet land --sign --push <sandbox>` puts the container's branch on GitHub, then `cfleet steer <sandbox> "resync and open the PR"`; the resync comes first because signing rewrote its commits$/m);
	assert.match(hostless.outside, /^- land: `cfleet land --sign <sandbox>` brings the container's branch here and the person pushes it from their own shell, then `cfleet steer <sandbox> "resync and open the PR"`; the resync comes first because signing rewrote its commits$/m);
	assert.match(ownHost, /^- land: the container pushes its own branch and opens its pull request; no landing takes them to GitHub$/m);
});

test("a host Linear level picks the server's endpoint: write the full one, read the read-only one", () => {
	const profiles = JSON.parse(WITH_PRIVATE);
	profiles["acme/*"].host = { ...profiles["acme/*"].host, linear: "read", linearServer: "linear-acme-host" };

	assert.deepEqual(hostLinearServers(parseProfiles(JSON.stringify(profiles))), {
		"linear-acme-host": "https://mcp.linear.app/mcp/readonly",
		"linear-private": "https://mcp.linear.app/mcp",
	});
});
