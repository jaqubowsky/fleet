import assert from "node:assert/strict";
import { test } from "node:test";
import { HARNESSES } from "../harness.ts";
import { REAL_PROFILES, WITH_PRIVATE } from "../profile/fixture.ts";
import { fakeIo } from "./fake-io.ts";
import { permissions } from "./permissions.ts";

const checkout = (origin: string, profiles = REAL_PROFILES, more: Record<string, unknown> = {}) =>
	fakeIo({ "read /root/host/repos.json": profiles, "stat /r": { size: 0, mtime: new Date(0), dir: true }, "git remote get-url origin": origin, ...more }, HARNESSES.claude);

test("profile prints a checkout's permissions, and the same for its owner/name", () => {
	const text = permissions({ root: "/root", repo: "/r" }, checkout("git@github.com:acme/webapp.git"));

	assert.match(text, /^# Permissions: acme\/webapp\n/);
	assert.match(text, /^- linear `read`: read Linear through `linear-acme-readonly`/m);
	assert.match(text, /^- sign `none`: commits stay unsigned; `cfleet land` signs only with --sign$/m);
	assert.equal(permissions({ root: "/root", repo: "acme/webapp" }, checkout("")), text);
	assert.throws(() => permissions({ root: "/root", repo: "nowhere" }, checkout("")), /neither a checkout nor owner\/name/);
});

test("profile --apply signs by the profile and moves origin to HTTPS where the host pushes on its own, printing each change", () => {
	const io = checkout("git@github.com:alice/private-app.git", WITH_PRIVATE, { "git config --local --get commit.gpgsign": "true" });

	const text = permissions({ root: "/root", repo: "/r", apply: true }, io);

	const gits = io.calls.filter((c) => c[0] === "git").map((c) => c.slice(2).join(" "));
	assert.ok(gits.includes("config --local commit.gpgsign false"));
	assert.ok(gits.includes("remote set-url origin https://github.com/alice/private-app.git"));
	assert.match(text, /\ncommit\.gpgsign true -> false\norigin git@github\.com:alice\/private-app\.git -> https:\/\/github\.com\/alice\/private-app\.git$/);
});

test("profile --apply turns signing on where it was unset, leaves origin where the host push needs a person, and needs a checkout", () => {
	const io = checkout("git@github.com:alice/cv.git", REAL_PROFILES, { "git config --local --get commit.gpgsign": new Error("exit 1") });

	const text = permissions({ root: "/root", repo: "/r", apply: true }, io);

	assert.match(text, /\ncommit\.gpgsign unset -> true$/);
	assert.ok(!io.calls.some((c) => c[0] === "git" && c.includes("set-url")));
	const aligned = checkout("git@github.com:alice/cv.git", REAL_PROFILES, { "git config --local --get commit.gpgsign": "true" });
	assert.match(permissions({ root: "/root", repo: "/r", apply: true }, aligned), /\nnothing changed$/);
	assert.throws(() => permissions({ root: "/root", repo: "alice/cv", apply: true }, checkout("")), /--apply sets a checkout/);
});
