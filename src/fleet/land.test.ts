import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { fakeIo } from "./fake-io.ts";
import { SAMPLE_PROFILES } from "../profile/fixture.ts";
import { baseBranch, isBase, land, landRefusal } from "./land.ts";

test("refusals: dirty, detached, base branch, checked out locally", () => {
	assert.match(
		landRefusal({ branch: "f", dirty: 2 }, "main", "origin/main")!,
		/2 uncommitted/,
	);
	assert.match(
		landRefusal({ branch: "", dirty: 0 }, "main", "origin/main")!,
		/detached/,
	);
	assert.match(
		landRefusal({ branch: "main", dirty: 0 }, "dev", "origin/main")!,
		/base branch/,
	);
	assert.match(
		landRefusal({ branch: "f", dirty: 0 }, "f", "origin/main")!,
		/checked out/,
	);
	assert.equal(
		landRefusal({ branch: "f", dirty: 0 }, "main", "origin/main"),
		undefined,
	);
});

test("base comparison is by whole branch name, never a suffix", () => {
	assert.ok(isBase("origin/main", "main"));
	assert.ok(isBase("main", "main"));
	assert.ok(!isBase("origin/main", "ain"));
	assert.ok(!isBase("origin/main", "dev"));
});

test("base branch resolves origin/HEAD to the real remote branch", () => {
	const io = fakeIo({ "git rev-parse --abbrev-ref origin/HEAD": "origin/dev" });
	assert.equal(baseBranch("/r", io), "origin/dev");
	const noHead = fakeIo({
		"git rev-parse --verify --quiet origin/HEAD": new Error("no"),
		"git rev-parse --verify --quiet origin/main": new Error("no"),
		"git rev-parse --verify --quiet origin/master": new Error("no"),
	});
	assert.equal(baseBranch("/r", noHead), "main");
});

const probe = 'sbx exec pi-a sh -c cd "$WORKSPACE_DIR" && printf';
const unsigning = {
	"read /root/host/repos.json": SAMPLE_PROFILES,
	"git remote get-url origin": "git@github.com:acme/webapp.git",
};

test("land fetches from the sandbox remote and stays unsigned where the profile gives host.sign none", () => {
	const io = fakeIo({
		...unsigning,
		[probe]: "web-1\t0\tabc",
		"git rev-parse --abbrev-ref origin/HEAD": "origin/main",
		"git branch --show-current": "main",
		"git --no-pager log": "abc N feat: x",
	});
	land({ sandbox: "pi-a", repo: "/r", root: "/root" }, io);
	assert.deepEqual(
		io.calls.find((c) => c[0] === "git" && c[2] === "fetch"),
		["git", "/r", "fetch", "--quiet", "sandbox-pi-a", "web-1:web-1"],
	);
	assert.ok(!io.calls.some((c) => c[0] === "git" && c.includes("-S")));
	assert.ok(io.lines.some((l) => /--sign/.test(l)));
});

test("land refuses before touching the repo", () => {
	const dirty = fakeIo({
		...unsigning,
		[probe]: "web-1\t3\tabc",
		"git rev-parse --abbrev-ref origin/HEAD": "origin/main",
		"git branch --show-current": "main",
	});
	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root" }, dirty),
		/3 uncommitted/,
	);
	assert.ok(!dirty.calls.some((c) => c[0] === "git" && c[2] === "fetch"));
	const onBase = fakeIo({
		...unsigning,
		[probe]: "main\t0\tabc",
		"git rev-parse --abbrev-ref origin/HEAD": "origin/main",
		"git branch --show-current": "dev",
	});
	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root" }, onBase),
		/main is the base branch/,
	);
	assert.ok(!onBase.calls.some((c) => c[0] === "git" && c[2] === "fetch"));
});

const multiManifest = {
	version: 1,
	repositories: [
		{
			repo: "/r",
			name: "acme/webapp",
			base: "main",
			baseSha: "1".repeat(40),
			branch: "task",
			workspace: "/r",
		},
		{
			repo: "/api",
			name: "acme/api",
			base: "develop",
			baseSha: "2".repeat(40),
			branch: "task",
			workspace: "/tmp/fleet-repos/api",
		},
	],
};
const apiProbe =
	'sbx exec pi-a sh -c cd "$1" && printf "%s\\t%s\\t%s" "$(git branch --show-current)" "$(git status --porcelain | wc -l | tr -d " ")" "$(git rev-parse HEAD)" -- /tmp/fleet-repos/api';
const multiAnswers = {
	...unsigning,
	"read /home/me/.config/harness/fleet/pi-a.json": JSON.stringify(multiManifest),
	[probe]: `task\t0\t${"3".repeat(40)}`,
	'sbx exec pi-a sh -c cd "$1" && printf': `task\t0\t${"3".repeat(40)}`,
	[apiProbe]: `task\t0\t${"4".repeat(40)}`,
	"git /r rev-parse origin/main": "1".repeat(40),
	"git /api rev-parse origin/develop": "2".repeat(40),
	"git /r rev-parse refs/heads/task": "3".repeat(40),
	"git /api rev-parse refs/heads/task": "4".repeat(40),
	"git /r bundle list-heads": `${"3".repeat(40)} refs/heads/task`,
	"git /api bundle list-heads": `${"4".repeat(40)} refs/heads/task`,
};

test("land records three imports in the group task and resumes after the third refuses", () => {
	const task = "/home/me/.sandboxes/groups/r-api-other/pi-a";
	const third = {
		repo: "/other",
		name: "acme/other",
		base: "main",
		baseSha: "5".repeat(40),
		branch: "task",
		workspace: "/tmp/fleet-repos/other",
	};
	const answers = {
		...multiAnswers,
		"read /home/me/.config/harness/fleet/pi-a.json": JSON.stringify({
			...multiManifest,
			task,
			repositories: [...multiManifest.repositories, third],
		}),
		'sbx exec pi-a sh -c cd "$1" && printf "%s\\t%s\\t%s" "$(git branch --show-current)" "$(git status --porcelain | wc -l | tr -d " ")" "$(git rev-parse HEAD)" -- /tmp/fleet-repos/other': `task\t0\t${"6".repeat(40)}`,
		"git /other rev-parse origin/main": "5".repeat(40),
		"git /other rev-parse refs/heads/task": "6".repeat(40),
		"git /other bundle list-heads": `${"6".repeat(40)} refs/heads/task`,
	};
	const io = fakeIo({
		...answers,
		"git /other fetch --quiet": new Error("third import rejected"),
	});

	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root" }, io),
		/acme\/other import refused.*pending in pi-a\nthird import rejected/,
	);
	const receipt = io.files[`${task}/repositories.json`];
	assert.ok(receipt);
	assert.deepEqual(
		JSON.parse(receipt).repositories.map(
			(entry: { landedSha?: string }) => entry.landedSha,
		),
		["3".repeat(40), "4".repeat(40), undefined],
	);
	const retry = fakeIo({
		...answers,
		"read /home/me/.config/harness/fleet/pi-a.json": receipt,
		"git /r for-each-ref": "3".repeat(40),
		"git /api for-each-ref": "4".repeat(40),
	});

	land({ sandbox: "pi-a", repo: "/r", root: "/root" }, retry);

	assert.deepEqual(
		retry.calls
			.filter((call) => call[0] === "git" && call[2] === "fetch")
			.map((call) => call[1]),
		["/other"],
	);
	assert.equal(
		JSON.parse(retry.files[`${task}/repositories.json`]).repositories[2]
			.landedSha,
		"6".repeat(40),
	);
	assert.ok(!retry.calls.some((call) => call.includes("--force")));
});

test("one command imports, signs and pushes every repository, with signing before any push", () => {
	for (const count of [1, 3]) {
		const entries = [
			...multiManifest.repositories,
			{
				...multiManifest.repositories[1],
				repo: "/third",
				name: "acme/third",
				workspace: "/third",
			},
		].slice(0, count);
		const io = fakeIo({
			...multiAnswers,
			"read /home/me/.config/harness/fleet/pi-a.json": JSON.stringify({
				version: 1,
				repositories: entries,
			}),
			"git /third rev-parse origin/develop": "2".repeat(40),
			"git /third bundle list-heads": `${"3".repeat(40)} refs/heads/task`,
			"git /third rev-parse refs/heads/task": "7".repeat(40),
			"git rev-list --reverse": "c1",
			"git rev-parse HEAD": "a".repeat(40),
		});

		land(
			{ sandbox: "pi-a", repo: "/r", root: "/root", sign: true, push: true },
			io,
		);

		const saved = JSON.parse(
			io.files["/home/me/.config/harness/fleet/pi-a.json"],
		);
		assert.equal(saved.repositories.length, count);
		assert.ok(
			saved.repositories.every(
				(entry: { signedSha: string; landedSha: string; pushedSha: string }) =>
					entry.signedSha &&
					entry.signedSha === entry.landedSha &&
					entry.pushedSha === entry.landedSha,
			),
		);
		const signatures = io.calls
			.map((call, index) => (call.includes("-S") ? index : -1))
			.filter((index) => index >= 0);
		const pushes = io.calls
			.map((call, index) => (call[0] === "git" && call[2] === "push" ? index : -1))
			.filter((index) => index >= 0);
		assert.equal(signatures.length, count);
		assert.equal(pushes.length, count);
		assert.ok(Math.max(...signatures) < Math.min(...pushes));
	}
});

test("a combined land resumes after a refused push without signing or pushing again", () => {
	const answers = {
		...multiAnswers,
		"git /r rev-list --reverse": "c1",
		"git /api rev-list --reverse": "c2",
		"git /r rev-parse HEAD": "a".repeat(40),
		"git /api rev-parse HEAD": "b".repeat(40),
		"git /r rev-parse refs/heads/task": "a".repeat(40),
		"git /api rev-parse refs/heads/task": "b".repeat(40),
	};
	const refused = fakeIo({
		...answers,
		"git /api push --quiet": new Error("second push declined"),
	});
	const combined = {
		sandbox: "pi-a",
		repo: "/r",
		root: "/root",
		sign: true,
		push: true,
	};

	assert.throws(
		() => land(combined, refused),
		/acme\/webapp: GitHub a{40}; acme\/api: host b{40}[\s\S]*second push declined/,
	);
	const stored = refused.files["/home/me/.config/harness/fleet/pi-a.json"];
	const retry = fakeIo({
		...answers,
		"read /home/me/.config/harness/fleet/pi-a.json": stored,
		"git /r for-each-ref": "a".repeat(40),
		"git /api for-each-ref": "b".repeat(40),
		"git /r ls-remote --heads origin task": `${"a".repeat(40)}\trefs/heads/task`,
	});
	land(combined, retry);

	assert.ok(!retry.calls.some((call) => call.includes("-S")));
	assert.ok(!retry.calls.some((call) => call[0] === "git" && call[2] === "fetch"));
	assert.deepEqual(
		retry.calls
			.filter((call) => call[0] === "git" && call[2] === "push")
			.map((call) => call[1]),
		["/api"],
	);
	assert.equal(
		JSON.parse(retry.files["/home/me/.config/harness/fleet/pi-a.json"])
			.repositories[1].pushedSha,
		"b".repeat(40),
	);
});

test("a combined land resumes after a declined signature", () => {
	const answers = {
		...multiAnswers,
		"git /r rev-list --reverse": "c1",
		"git /api rev-list --reverse": "c2",
		"git /r rev-parse HEAD": "a".repeat(40),
		"git /api rev-parse HEAD": "b".repeat(40),
		"git /r rev-parse refs/heads/task": "a".repeat(40),
		"git /api rev-parse refs/heads/task": "b".repeat(40),
	};
	const combined = {
		sandbox: "pi-a",
		repo: "/r",
		root: "/root",
		sign: true,
		push: true,
	};
	const declined = fakeIo({
		...answers,
		"git /tmp/fleet-sign-task commit": new Error("signature declined"),
	});

	assert.throws(() => land(combined, declined), /signature declined/);
	const leftover = !declined.calls.some(
		(call) => call.join(" ") === "git /r worktree remove --force /tmp/fleet-sign-task",
	);
	const retry = fakeIo({
		...answers,
		...(leftover && {
			"stat /tmp/fleet-sign-task": { size: 0, dir: true, mtime: new Date(0) },
		}),
		"read /home/me/.config/harness/fleet/pi-a.json":
			declined.files["/home/me/.config/harness/fleet/pi-a.json"],
		"git /r rev-parse refs/heads/task": "3".repeat(40),
		"git /api rev-parse refs/heads/task": "4".repeat(40),
		"git /r for-each-ref": "3".repeat(40),
		"git /api for-each-ref": "4".repeat(40),
	});
	land(combined, retry);

	assert.deepEqual(
		retry.calls
			.filter((call) => call[0] === "git" && call[2] === "push")
			.map((call) => call[1]),
		["/r", "/api"],
	);
});

test("land refuses both imports when the API clone is dirty", () => {
	const io = fakeIo({
		...multiAnswers,
		[apiProbe]: `task\t1\t${"4".repeat(40)}`,
	});

	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root" }, io),
		/api.*uncommitted/,
	);
	assert.ok(!io.calls.some((call) => call[0] === "git" && call[2] === "fetch"));
});

test("land refuses moved bases and dirty host checkouts before either import", () => {
	const moved = fakeIo({
		...multiAnswers,
		"git /api rev-parse origin/develop": "f".repeat(40),
	});
	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root" }, moved),
		/acme\/api: base origin\/develop moved/,
	);
	assert.ok(
		!moved.calls.some((call) => call[0] === "git" && call[2] === "fetch"),
	);

	const dirty = fakeIo({
		...multiAnswers,
		"git /api status --porcelain": " M CLAUDE.md",
	});
	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root" }, dirty),
		/acme\/api: the host checkout has uncommitted work/,
	);
	assert.ok(
		!dirty.calls.some((call) => call[0] === "git" && call[2] === "fetch"),
	);
});

test("land refuses an unrelated API head or a bundle that changed after probing", () => {
	const unrelated = fakeIo({
		...multiAnswers,
		"sbx exec pi-a git -C /tmp/fleet-repos/api merge-base --is-ancestor":
			new Error("unrelated history"),
	});
	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root" }, unrelated),
		/acme\/api: .*recorded base/,
	);
	assert.ok(
		!unrelated.calls.some((call) => call[0] === "git" && call[2] === "fetch"),
	);

	const changed = fakeIo({
		...multiAnswers,
		"git /api bundle list-heads": `${"f".repeat(40)} refs/heads/task`,
	});
	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root" }, changed),
		/acme\/api: bundle head changed/,
	);
	assert.ok(
		!changed.calls.some((call) => call[0] === "git" && call[2] === "fetch"),
	);
});

test("land preserves the first import and resumes the second after refusal", () => {
	const refused = fakeIo({
		...multiAnswers,
		"git /api fetch --quiet": new Error("API import rejected"),
	});

	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root" }, refused),
		/acme\/api import refused; acme\/webapp: host 3{40}; acme\/api: pending in pi-a\nAPI import rejected/,
	);
	const stored = refused.files["/home/me/.config/harness/fleet/pi-a.json"];
	assert.ok(stored);
	assert.equal(JSON.parse(stored).repositories[0].landedSha, "3".repeat(40));
	assert.equal(JSON.parse(stored).repositories[1].landedSha, undefined);
	assert.ok(
		refused.calls.some(
			(call) => call[0] === "git" && call[1] === "/r" && call[2] === "fetch",
		),
	);
	assert.ok(!refused.calls.some((call) => call.includes("--force")));

	const retry = fakeIo({
		...multiAnswers,
		"read /home/me/.config/harness/fleet/pi-a.json": stored,
		"git /r for-each-ref": "3".repeat(40),
	});
	land({ sandbox: "pi-a", repo: "/r", root: "/root" }, retry);

	assert.ok(
		!retry.calls.some(
			(call) => call[0] === "git" && call[1] === "/r" && call[2] === "fetch",
		),
	);
	assert.ok(
		retry.calls.some(
			(call) => call[0] === "git" && call[1] === "/api" && call[2] === "fetch",
		),
	);
	assert.equal(
		JSON.parse(retry.files["/home/me/.config/harness/fleet/pi-a.json"])
			.repositories[1].landedSha,
		"4".repeat(40),
	);
});

test("three Git bundles import fast-forward branches without changing host checkouts", (t) => {
	const root = mkdtempSync(join(tmpdir(), "fleet-two-repos-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" };
	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env }).trim();
	const repos = ["one", "two", "three"].map((name, index) => {
		const base = index === 0 ? "main" : "develop";
		const remote = join(root, `${name}.git`);
		execFileSync(
			"git",
			["init", "--quiet", "--bare", "--initial-branch", base, remote],
			{ env },
		);
		const host = join(root, name, "checkout");
		mkdirSync(dirname(host), { recursive: true });
		execFileSync("git", ["clone", "--quiet", remote, host], { env });
		git(host, "config", "user.name", "fixture");
		git(host, "config", "user.email", "fixture@example.invalid");
		writeFileSync(join(host, "tracked.txt"), name);
		git(host, "add", "tracked.txt");
		git(host, "commit", "--quiet", "-m", "base");
		git(host, "push", "--quiet", "origin", base);
		git(host, "fetch", "--quiet", "origin");
		const guest = join(root, `guest-${name}`);
		execFileSync("git", ["clone", "--quiet", remote, guest], { env });
		git(guest, "config", "user.name", "fixture");
		git(guest, "config", "user.email", "fixture@example.invalid");
		git(guest, "switch", "--quiet", "-c", "task");
		git(guest, "commit", "--quiet", "--allow-empty", "-m", `work in ${name}`);
		return {
			repo: host,
			name: `acme/${name}`,
			base,
			baseSha: git(host, "rev-parse", `origin/${base}`),
			branch: "task",
			workspace: guest,
		};
	});
	const io = fakeIo();
	io.home = root;
	io.tmp = root;
	io.files[`${root}/.config/harness/fleet/pi-a.json`] = JSON.stringify({
		version: 1,
		repositories: repos,
	});
	io.git = (args, cwd) => git(cwd, ...args);
	const fakeSbx = io.sbx;
	io.sbx = (args, opts) => {
		fakeSbx(args, opts);
		if (args[0] === "exec" && args[2] === "git")
			return git(args[4], ...args.slice(5));
		if (args[0] === "exec" && args[2] === "sh") {
			const command = args.slice(6);
			if (args[4].includes("bundle create"))
				command[1] = join(root, basename(command[1]));
			return execFileSync("sh", ["-c", args[4], "--", ...command], {
				encoding: "utf8",
				env,
			}).trim();
		}
		if (args[0] === "cp") {
			mkdirSync(dirname(args[2]), { recursive: true });
			copyFileSync(join(root, basename(args[1])), args[2]);
		}
		return "";
	};

	for (const entry of repos)
		assert.throws(() =>
			git(entry.repo, "show-ref", "--verify", "refs/heads/task"),
		);
	land({ sandbox: "pi-a", repo: repos[0].repo, root }, io);

	for (const entry of repos) {
		assert.equal(
			git(entry.repo, "rev-parse", "refs/heads/task"),
			git(entry.workspace, "rev-parse", "HEAD"),
		);
		assert.equal(git(entry.repo, "rev-parse", "HEAD"), entry.baseSha);
		assert.equal(git(entry.repo, "status", "--porcelain"), "");
	}
});

test("a refused second push keeps both host commits and records the first published SHA", () => {
	const signed = {
		version: 1,
		repositories: multiManifest.repositories.map((entry, index) => ({
			...entry,
			sourceSha: (index === 0 ? "3" : "4").repeat(40),
			landedSha: (index === 0 ? "a" : "b").repeat(40),
			signedSha: (index === 0 ? "a" : "b").repeat(40),
		})),
	};
	const refused = fakeIo({
		...multiAnswers,
		"read /home/me/.config/harness/fleet/pi-a.json": JSON.stringify(signed),
		"git /r for-each-ref": "a".repeat(40),
		"git /api for-each-ref": "b".repeat(40),
		"git /api push --quiet": new Error("second push declined"),
	});

	assert.throws(
		() =>
			land({ sandbox: "pi-a", repo: "/r", root: "/root", push: true }, refused),
		/acme\/webapp: GitHub a{40}; acme\/api: host b{40}[\s\S]*second push declined/,
	);
	const stored = refused.files["/home/me/.config/harness/fleet/pi-a.json"];
	assert.equal(JSON.parse(stored).repositories[0].pushedSha, "a".repeat(40));
	assert.equal(JSON.parse(stored).repositories[1].pushedSha, undefined);
	assert.ok(!refused.calls.some((call) => call.includes("--force")));

	const retry = fakeIo({
		...multiAnswers,
		"read /home/me/.config/harness/fleet/pi-a.json": stored,
		"git /r for-each-ref": "a".repeat(40),
		"git /api for-each-ref": "b".repeat(40),
		"git /r ls-remote --heads origin task": `${"a".repeat(40)}\trefs/heads/task`,
	});
	land({ sandbox: "pi-a", repo: "/r", root: "/root", push: true }, retry);

	assert.ok(
		!retry.calls.some(
			(call) => call[0] === "git" && call[1] === "/r" && call[2] === "push",
		),
	);
	assert.ok(
		retry.calls.some(
			(call) => call[0] === "git" && call[1] === "/api" && call[2] === "push",
		),
	);
	assert.equal(
		JSON.parse(retry.files["/home/me/.config/harness/fleet/pi-a.json"])
			.repositories[1].pushedSha,
		"b".repeat(40),
	);
});

test("a human-sign profile refuses a push until both imports have been signed separately", () => {
	const profiles = JSON.parse(SAMPLE_PROFILES);
	profiles["acme/*"].host.sign = "human";
	const imported = {
		version: 1,
		repositories: multiManifest.repositories.map((entry, index) => ({
			...entry,
			sourceSha: (index === 0 ? "3" : "4").repeat(40),
			landedSha: (index === 0 ? "3" : "4").repeat(40),
		})),
	};
	const io = fakeIo({
		...multiAnswers,
		"read /root/host/repos.json": JSON.stringify(profiles),
		"read /home/me/.config/harness/fleet/pi-a.json": JSON.stringify(imported),
	});

	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root", push: true }, io),
		/acme\/webapp: sign the landed branch before requesting a push/,
	);
	assert.ok(!io.calls.some((call) => call[0] === "git" && call[2] === "push"));
});

test("a fresh human-sign task cannot import and push unsigned commits", () => {
	const profiles = JSON.parse(SAMPLE_PROFILES);
	profiles["acme/*"].host.sign = "human";
	const io = fakeIo({
		...multiAnswers,
		"read /root/host/repos.json": JSON.stringify(profiles),
	});

	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root", push: true }, io),
		/acme\/webapp: import and sign before requesting a push/,
	);
	assert.ok(
		!io.calls.some(
			(call) => call[0] === "git" && ["fetch", "push"].includes(call[2]),
		),
	);
});

test("a second round cannot import new work during a push", () => {
	const profiles = JSON.parse(SAMPLE_PROFILES);
	profiles["acme/*"].host.sign = "human";
	const manifest = {
		version: 1,
		repositories: multiManifest.repositories.map((entry, index) => ({
			...entry,
			sourceSha: (index === 0 ? "3" : "4").repeat(40),
			landedSha: (index === 0 ? "3" : "4").repeat(40),
			signedSha: (index === 0 ? "3" : "4").repeat(40),
		})),
	};
	const io = fakeIo({
		...multiAnswers,
		"read /root/host/repos.json": JSON.stringify(profiles),
		"read /home/me/.config/harness/fleet/pi-a.json": JSON.stringify(manifest),
		'sbx exec pi-a sh -c cd "$1" && printf': `task\t0\t${"5".repeat(40)}`,
		"git /r bundle list-heads": `${"5".repeat(40)} refs/heads/task`,
		"git /r for-each-ref": "3".repeat(40),
		"git /api for-each-ref": "4".repeat(40),
	});

	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root", push: true }, io),
		/acme\/webapp: import and sign before requesting a push/,
	);
	assert.ok(
		!io.calls.some(
			(call) => call[0] === "git" && ["fetch", "push"].includes(call[2]),
		),
	);
});

test("later signing excludes the branch tip already published by a prior round", () => {
	const manifest = {
		version: 1,
		repositories: multiManifest.repositories.map((entry, index) => ({
			...entry,
			sourceSha: (index === 0 ? "5" : "4").repeat(40),
			landedSha: (index === 0 ? "5" : "4").repeat(40),
			signedSha: (index === 0 ? "3" : "4").repeat(40),
			pushedSha: (index === 0 ? "3" : "4").repeat(40),
		})),
	};
	const io = fakeIo({
		...multiAnswers,
		"read /home/me/.config/harness/fleet/pi-a.json": JSON.stringify(manifest),
		'sbx exec pi-a sh -c cd "$1" && printf': `task\t0\t${"5".repeat(40)}`,
		"git /r for-each-ref": "5".repeat(40),
		"git /api for-each-ref": "4".repeat(40),
		"git /r ls-remote --heads origin task": `${"3".repeat(40)}\trefs/heads/task`,
		"git /r rev-list --reverse": "new-commit",
		"git /r rev-parse HEAD": "a".repeat(40),
		"git /r rev-parse refs/heads/task": "a".repeat(40),
	});

	land({ sandbox: "pi-a", repo: "/r", root: "/root", sign: true }, io);

	assert.ok(
		io.calls.some(
			(call) =>
				call.join(" ") ===
				`git /r rev-list --reverse task --not origin/main ${"3".repeat(40)}`,
		),
	);
	assert.ok(
		!io.calls.some(
			(call) => call[0] === "git" && call[1] === "/api" && call[2] === "commit",
		),
	);
	assert.ok(!io.calls.some((call) => call[0] === "git" && call[2] === "push"));
});

test("multi-repo sign signs each imported head on the Mac without a push or skipped hook", () => {
	const imported = {
		version: 1,
		repositories: multiManifest.repositories.map((entry, index) => ({
			...entry,
			sourceSha: (index === 0 ? "3" : "4").repeat(40),
			landedSha: (index === 0 ? "3" : "4").repeat(40),
		})),
	};
	const io = fakeIo({
		...multiAnswers,
		"read /home/me/.config/harness/fleet/pi-a.json": JSON.stringify(imported),
		"git /r for-each-ref": "3".repeat(40),
		"git /api for-each-ref": "4".repeat(40),
		"git /r rev-list --reverse": "c1",
		"git /api rev-list --reverse": "c2",
		"git /r rev-parse HEAD": "a".repeat(40),
		"git /api rev-parse HEAD": "b".repeat(40),
		"git /r rev-parse refs/heads/task": "a".repeat(40),
		"git /api rev-parse refs/heads/task": "b".repeat(40),
	});

	land({ sandbox: "pi-a", repo: "/r", root: "/root", sign: true }, io);

	const signs = io.calls.filter(
		(call) => call[0] === "git" && call[2] === "commit" && call.includes("-S"),
	);
	assert.equal(signs.length, 2);
	assert.ok(
		!io.calls.some(
			(call) =>
				call.includes("--no-verify") ||
				call.join(" ").includes("hooksPath=/dev/null"),
		),
	);
	assert.ok(!io.calls.some((call) => call[0] === "git" && call[2] === "push"));
	const saved = JSON.parse(io.files["/home/me/.config/harness/fleet/pi-a.json"]);
	assert.deepEqual(
		saved.repositories.map((entry: { signedSha: string }) => entry.signedSha),
		["a".repeat(40), "b".repeat(40)],
	);
});

test("land --sign amends the first commit and rebases the rest with -S, in a worktree under tmp", () => {
	const io = fakeIo({
		...unsigning,
		[probe]: "web-1\t0\tabc",
		"git rev-parse --abbrev-ref origin/HEAD": "origin/main",
		"git branch --show-current": "main",
		"git rev-list --reverse": "c1\nc2\nc3",
		"git rev-parse HEAD": "signed1",
	});
	land({ sandbox: "pi-a", repo: "/r", root: "/root", sign: true }, io);
	const gits = io.calls
		.filter((c) => c[0] === "git")
		.map((c) => c.slice(2).join(" "));
	const add = gits.indexOf(
		"worktree add --quiet --detach /tmp/fleet-sign-web-1 c1",
	);
	assert.ok(add >= 0 && gits[add - 1] === "worktree prune");
	assert.equal(
		gits[add + 1],
		"commit --quiet --amend --no-edit --allow-empty -S",
	);
	assert.ok(
		gits.some((g) => g.includes("rebase --quiet --onto signed1 c1 web-1 --exec")),
	);
	assert.ok(gits.some((g) => g === "update-ref refs/heads/web-1 signed1"));
	assert.ok(gits.at(-1)!.startsWith("worktree remove"));
	assert.ok(!gits.some((g) => /--no-verify|hooksPath|--abort/.test(g)));
});

test("land --sign aborts a failed rebase and removes its worktree, leaving the branch", () => {
	const empty = fakeIo({
		...unsigning,
		[probe]: "web-1\t0\tabc",
		"git rev-parse --abbrev-ref origin/HEAD": "origin/main",
		"git branch --show-current": "main",
		"git rev-list --reverse": "",
	});
	land({ sandbox: "pi-a", repo: "/r", root: "/root", sign: true }, empty);
	assert.ok(!empty.calls.some((c) => c[0] === "git" && c[2] === "worktree"));

	const failing = fakeIo({
		...unsigning,
		[probe]: "web-1\t0\tabc",
		"git rev-parse --abbrev-ref origin/HEAD": "origin/main",
		"git branch --show-current": "main",
		"git rev-list --reverse": "c1\nc2",
		"git rev-parse HEAD": "s1",
		"git rebase": new Error("gpg failed"),
	});
	assert.throws(
		() =>
			land({ sandbox: "pi-a", repo: "/r", root: "/root", sign: true }, failing),
		/gpg failed/,
	);
	const gits = failing.calls
		.filter((c) => c[0] === "git")
		.map((c) => c.slice(2).join(" "));
	assert.ok(gits.some((g) => g === "rebase --abort"));
	assert.ok(!gits.some((g) => g.startsWith("update-ref")));
	assert.ok(gits.at(-1)!.startsWith("worktree remove"));
});

const landed = {
	...unsigning,
	[probe]: "web-1\t0\tabc",
	"git rev-parse --abbrev-ref origin/HEAD": "origin/main",
	"git branch --show-current": "main",
};

test("land --sign signs only the commits origin does not have yet", () => {
	const io = fakeIo({
		...landed,
		"git rev-parse --verify --quiet origin/web-1": "tip",
		"git rev-list --reverse": "c1",
		"git rev-parse HEAD": "signed1",
	});
	land({ sandbox: "pi-a", repo: "/r", root: "/root", sign: true }, io);
	const gits = io.calls
		.filter((c) => c[0] === "git")
		.map((c) => c.slice(2).join(" "));

	assert.ok(gits.includes("fetch --quiet origin web-1"));
	assert.ok(
		gits.includes("rev-list --reverse web-1 --not origin/main origin/web-1"),
	);
});

test("land --sign takes the whole branch when origin has never seen it", () => {
	const io = fakeIo({
		...landed,
		"git rev-parse --verify --quiet origin/web-1": new Error("unknown revision"),
		"git rev-list --reverse": "c1",
		"git rev-parse HEAD": "signed1",
	});
	land({ sandbox: "pi-a", repo: "/r", root: "/root", sign: true }, io);
	const gits = io.calls
		.filter((c) => c[0] === "git")
		.map((c) => c.slice(2).join(" "));

	assert.ok(gits.includes("rev-list --reverse web-1 --not origin/main"));
});

test("land --sign refreshes the base before it lists or counts the commits to sign", () => {
	const io = fakeIo({
		...landed,
		"git rev-parse --verify --quiet origin/web-1": new Error("unknown revision"),
		"git rev-list --reverse": "c1",
		"git rev-parse HEAD": "signed1",
	});

	land({ sandbox: "pi-a", repo: "/r", root: "/root", sign: true }, io);

	const gits = io.calls
		.filter((c) => c[0] === "git")
		.map((c) => c.slice(2).join(" "));
	const refresh = gits.indexOf("fetch --quiet origin main");
	assert.ok(refresh >= 0);
	assert.ok(refresh < gits.findIndex((g) => g.startsWith("--no-pager log")));
	assert.ok(refresh < gits.findIndex((g) => g.startsWith("rev-list --reverse")));
});

test("land --push never forces, and a rejected push names whose command the force is", () => {
	const io = fakeIo(landed);
	land({ sandbox: "pi-a", repo: "/r", root: "/root", push: true }, io);
	const gits = io.calls
		.filter((c) => c[0] === "git")
		.map((c) => c.slice(2).join(" "));

	assert.ok(gits.includes("push --quiet -u origin web-1"));
	assert.ok(!gits.some((g) => /force/.test(g)));

	const rejected = fakeIo({
		...landed,
		"git push": new Error("! [rejected] web-1 -> web-1 (non-fast-forward)"),
	});
	assert.throws(
		() =>
			land({ sandbox: "pi-a", repo: "/r", root: "/root", push: true }, rejected),
		/non-fast-forward[\s\S]*your own command/,
	);
});

test("land without --sign or --push never touches the remote where the profile gives host.sign none", () => {
	const io = fakeIo(landed);
	land({ sandbox: "pi-a", repo: "/r", root: "/root" }, io);

	assert.ok(
		!io.calls.some(
			(c) =>
				c[0] === "git" &&
				c.includes("origin") &&
				(c.includes("fetch") || c.includes("push")),
		),
	);
});

test("land refuses a container branch that no longer descends from the landed one", () => {
	const io = fakeIo({
		...landed,
		"git fetch --quiet sandbox-pi-a": new Error(
			"! [rejected] web-1 -> web-1 (non-fast-forward)",
		),
	});

	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root" }, io),
		/signatures included[\s\S]*reset --hard origin\/web-1/,
	);
	assert.ok(!io.calls.some((c) => c[0] === "git" && c.includes("--no-pager")));
});

test("land passes a fetch that never reached the container through as it is", () => {
	const io = fakeIo({
		...landed,
		"git fetch --quiet sandbox-pi-a": new Error(
			"fatal: unable to connect to 127.0.0.1: errno=Operation not permitted",
		),
	});

	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root" }, io),
		(error: Error) =>
			/unable to connect/.test(error.message) && !/descendant/.test(error.message),
	);
});

test("land signs where the profile gives the host sign human, without --sign", () => {
	const io = fakeIo({
		...landed,
		"git remote get-url origin": "git@github.com:alice/cv.git",
		"git rev-parse --verify --quiet origin/web-1": new Error("unknown revision"),
		"git rev-list --reverse": "c1",
		"git rev-parse HEAD": "signed1",
	});

	land({ sandbox: "pi-a", repo: "/r", root: "/root" }, io);

	assert.ok(io.calls.some((c) => c[0] === "git" && c.includes("-S")));
	assert.ok(io.lines.includes("1 commit(s) signed on web-1"));
});

test("land reads the profile before it imports anything", () => {
	const io = fakeIo({ ...landed, "read /root/host/repos.json": undefined });

	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root" }, io),
		/missing \/root\/host\/repos.json/,
	);
	assert.ok(!io.calls.some((c) => c[0] === "git" && c[2] === "fetch"));
});

test("land --push refuses where the profile gives the host no push, before it imports anything", () => {
	const profiles = JSON.parse(SAMPLE_PROFILES);
	profiles["acme/*"].host.push = "none";
	const io = fakeIo({
		...landed,
		"read /root/host/repos.json": JSON.stringify(profiles),
	});

	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root", push: true }, io),
		/host\.push is none/,
	);
	assert.ok(
		!io.calls.some(
			(c) => c[0] === "git" && (c[2] === "fetch" || c[2] === "push"),
		),
	);
});
