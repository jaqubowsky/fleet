import assert from "node:assert/strict";
import { test } from "node:test";
import { HARNESSES } from "../harness.ts";
import { PRIVATE_PROFILE, PRIVATE_REPO, REPO_PROFILES, SAMPLE_PROFILES, WITH_PRIVATE } from "../profile/fixture.ts";
import { fakeIo } from "./fake-io.ts";
import { permissions } from "./permissions.ts";
import { describe, parseProfiles, profileFor } from "../profile/profile.ts";

const checkout = (origin: string, profiles = SAMPLE_PROFILES, more: Record<string, unknown> = {}, harness = HARNESSES.claude) =>
	fakeIo({ "read /root/host/repos.json": profiles, "stat /r": { size: 0, mtime: new Date(0), dir: true }, "git remote get-url origin": origin, "git rev-parse --show-toplevel": "/r", ...more }, harness);

const USER_PROFILES = "read /home/me/.config/harness/repos.json";
const REGISTERED = { "read /home/me/.claude.json": JSON.stringify({ projects: { "/r": { mcpServers: { "linear-private": { type: "http", url: "https://mcp.linear.app/mcp" } } } } }) };

test("profile prints a checkout's permissions, and the same for its owner/name", () => {
	const text = permissions({ root: "/root", repo: "/r" }, checkout("git@github.com:acme/webapp.git"));

	assert.match(text, /^# Permissions: acme\/webapp\n/);
	assert.match(text, /^- linear `read`: read Linear through `linear-acme-readonly`/m);
	assert.match(text, /^- sign `none`: commits stay unsigned; `cfleet land` signs only with --sign$/m);
	assert.equal(permissions({ root: "/root", repo: "acme/webapp" }, checkout("")), text);
	assert.throws(() => permissions({ root: "/root", repo: "nowhere" }, checkout("")), /neither a checkout nor owner\/name/);
});

const HTTPS = "https://github.com/alice/private-app.git";
const PIN = `url.${HTTPS}.insteadOf`;
const HELPER = "credential.https://github.com.helper";
const TRACKING = "branch.autoSetupMerge";

test("profile --apply signs by the profile, moves origin to HTTPS and stops branch tracking where the host pushes on its own, printing each change", () => {
	const io = checkout("git@github.com:alice/private-app.git", WITH_PRIVATE, {
		"git config --local --get commit.gpgsign": "true",
		[`git config --local --get ${PIN}`]: new Error("exit 1"),
		[`git config --local --get ${HELPER}`]: new Error("exit 1"),
		[`git config --local --get ${TRACKING}`]: new Error("exit 1"),
		"git remote get-url --push origin": HTTPS,
	});

	const text = permissions({ root: "/root", repo: "/r", apply: true }, io);

	const gits = io.calls.filter((c) => c[0] === "git").map((c) => c.slice(2).join(" "));
	assert.ok(gits.includes("config --local commit.gpgsign false"));
	assert.ok(gits.includes(`remote set-url origin ${HTTPS}`));
	assert.ok(gits.includes(`config --local ${TRACKING} false`));
	assert.match(text, /\ncommit\.gpgsign true -> false\norigin git@github\.com:alice\/private-app\.git -> https:\/\/github\.com\/alice\/private-app\.git\n/);
	assert.match(text, /\nbranch\.autoSetupMerge unset -> false\n/);
});

test("profile --apply keeps a host push on HTTPS against the person's own url rewrites, with the session's GH_TOKEN as its only credential", () => {
	const io = checkout("git@github.com-personal:alice/private-app.git", WITH_PRIVATE, {
		"git config --local --get commit.gpgsign": "false",
		[`git config --local --get ${PIN}`]: new Error("exit 1"),
		[`git config --local --get ${HELPER}`]: "osxkeychain",
		[`git config --local --get ${TRACKING}`]: "false",
		"git remote get-url --push origin": HTTPS,
	});

	const text = permissions({ root: "/root", repo: "/r", apply: true }, io);

	const gits = io.calls.filter((c) => c[0] === "git").map((c) => c.slice(2));
	assert.deepEqual(gits.filter((args) => args.includes(PIN) && !args.includes("--get")), [["config", "--local", "--replace-all", PIN, HTTPS]]);
	assert.deepEqual(gits.filter((args) => args.includes(HELPER) && !args.includes("--get")), [
		["config", "--local", "--replace-all", HELPER, ""],
		["config", "--local", "--add", HELPER, "!gh auth git-credential"],
	]);
	assert.match(text, new RegExp(`\\n${PIN.replaceAll(".", "\\.")} unset -> ${HTTPS.replaceAll(".", "\\.")}\\n${HELPER.replaceAll(".", "\\.")} osxkeychain -> !gh auth git-credential\\n`));
});

test("profile --apply fails where origin still pushes somewhere other than HTTPS", () => {
	const io = checkout("git@github.com:alice/private-app.git", WITH_PRIVATE, { "git remote get-url --push origin": "git@github.com-personal:alice/private-app.git" });

	assert.throws(() => permissions({ root: "/root", repo: "/r", apply: true }, io), /origin pushes to git@github\.com-alice:alice\/private-app\.git, not https:\/\/github\.com\/alice\/private-app\.git/);
});

test("profile --apply on a checkout already set for host pushes changes nothing", () => {
	const io = checkout(HTTPS, WITH_PRIVATE, {
		"git config --local --get commit.gpgsign": "false",
		[`git config --local --get ${PIN}`]: HTTPS,
		[`git config --local --get ${HELPER}`]: "!gh auth git-credential",
		[`git config --local --get ${TRACKING}`]: "false",
		"git remote get-url --push origin": HTTPS,
		...REGISTERED,
	});

	assert.match(permissions({ root: "/root", repo: "/r", apply: true }, io), /\nnothing changed$/);
});

test("profile --apply turns signing on where it was unset, leaves origin where the host push needs a person, and needs a checkout", () => {
	const io = checkout("git@github.com:alice/cv.git", SAMPLE_PROFILES, { "git config --local --get commit.gpgsign": new Error("exit 1") });

	const text = permissions({ root: "/root", repo: "/r", apply: true }, io);

	assert.match(text, /\ncommit\.gpgsign unset -> true$/);
	assert.ok(!io.calls.some((c) => c[0] === "git" && c.includes("set-url")));
	const aligned = checkout("git@github.com:alice/cv.git", SAMPLE_PROFILES, { "git config --local --get commit.gpgsign": "true" });
	assert.match(permissions({ root: "/root", repo: "/r", apply: true }, aligned), /\nnothing changed$/);
	assert.throws(() => permissions({ root: "/root", repo: "alice/cv", apply: true }, checkout("")), /--apply sets a checkout/);
});

test("profile prints the repository's overlay under the levels, and says where it would live when there is none", () => {
	const overlay = "# acme/webapp\n\n## Merge method\n\n--squash\n";
	const levels = describe("acme/webapp", profileFor(parseProfiles(SAMPLE_PROFILES), "acme/webapp"), "cfleet");
	const read = { "read /home/me/.config/harness/projects/acme/webapp.md": overlay, "read /root/host/projects/acme/webapp.md": "# the harness copy\n" };

	assert.equal(
		permissions({ root: "/root", repo: "acme/webapp" }, checkout("", SAMPLE_PROFILES, read)),
		`${levels}\nOverlay ~/.config/harness/projects/acme/webapp.md, which containers read as project.md:\n\n${overlay}`,
	);
	assert.equal(
		permissions({ root: "/root", repo: "acme/webapp" }, checkout("")),
		`${levels}\nNo overlay: ~/.config/harness/projects/acme/webapp.md does not exist`,
	);
});

test("profile reads the person's own profile file over the harness's, and the harness's * for a repository that file omits", () => {
	const mine = JSON.stringify({ [PRIVATE_REPO]: PRIVATE_PROFILE });
	const io = checkout("", REPO_PROFILES, { [USER_PROFILES]: mine });

	assert.match(permissions({ root: "/root", repo: PRIVATE_REPO }, io), /^Profile `alice\/private-app` of `~\/\.config\/harness\/repos\.json`\./m);
	assert.match(permissions({ root: "/root", repo: "someone/else" }, io), /^Profile `\*` of `host\/repos\.json`\./m);
});

const PRIVATE_SET = {
	"git config --local --get commit.gpgsign": "false",
	[`git config --local --get ${PIN}`]: HTTPS,
	[`git config --local --get ${HELPER}`]: "!gh auth git-credential",
	[`git config --local --get ${TRACKING}`]: "false",
	"git remote get-url --push origin": HTTPS,
	"git rev-parse --path-format=absolute --git-path info/exclude": "/r/.git/info/exclude",
};

test("profile --apply registers the host Linear server for the checkout alone: claude in its local scope, pi and omp in the checkout's own mcp.json kept out of git", () => {
	const claude = checkout(HTTPS, WITH_PRIVATE, PRIVATE_SET);
	const text = permissions({ root: "/root", repo: "/r", apply: true }, claude);

	assert.deepEqual(claude.calls.filter((c) => c[0] === "run"), [["run", "/r", "claude", "mcp", "add", "--scope", "local", "--transport", "http", "linear-private", "https://mcp.linear.app/mcp"]]);
	assert.match(text, /\nhost Linear server linear-private registered for \/r in claude's local scope$/);

	const readOnly = { "read /home/me/.claude.json": JSON.stringify({ projects: { "/r": { mcpServers: { "linear-private": { type: "http", url: "https://mcp.linear.app/mcp/readonly" } } } } }) };
	const moved = checkout(HTTPS, WITH_PRIVATE, { ...PRIVATE_SET, ...readOnly });
	permissions({ root: "/root", repo: "/r", apply: true }, moved);
	assert.deepEqual(moved.calls.filter((c) => c[0] === "run").map((c) => c.slice(1, 5)), [["/r", "claude", "mcp", "remove"], ["/r", "claude", "mcp", "add"]]);

	for (const [harness, dir, entry] of [
		[HARNESSES.pi, ".pi", { url: "https://mcp.linear.app/mcp", auth: "oauth" }],
		[HARNESSES.omp, ".omp", { type: "http", url: "https://mcp.linear.app/mcp" }],
	] as const) {
		const context7 = { url: "https://mcp.context7.com/mcp" };
		const io = checkout(HTTPS, WITH_PRIVATE, { ...PRIVATE_SET, [`read /r/${dir}/mcp.json`]: JSON.stringify({ mcpServers: { context7 } }) }, harness);

		const applied = permissions({ root: "/root", repo: "/r", apply: true }, io);

		assert.deepEqual(JSON.parse(io.files[`/r/${dir}/mcp.json`]).mcpServers, { context7, "linear-private": entry });
		assert.ok(io.calls.some((c) => c.join(" ") === `append /r/.git/info/exclude /${dir}/`), harness.name);
		assert.match(applied, new RegExp(`\\nhost Linear server linear-private registered in /r/\\${dir}/mcp\\.json\\n/\\${dir}/ added to /r/\\.git/info/exclude$`));
		assert.ok(!io.calls.some((c) => c[0] === "run"));

		const again = checkout(HTTPS, WITH_PRIVATE, { ...PRIVATE_SET, [`read /r/${dir}/mcp.json`]: io.files[`/r/${dir}/mcp.json`], "read /r/.git/info/exclude": `/${dir}/\n` }, harness);
		assert.match(permissions({ root: "/root", repo: "/r", apply: true }, again), /\nnothing changed$/);
	}
});
