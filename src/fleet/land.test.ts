import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type TestContext, test } from "node:test";
import { fakeIo } from "./fake-io.ts";
import { SAMPLE_PROFILES } from "../profile/fixture.ts";
import { baseBranch, isBase, land, landRefusal } from "./land.ts";

test("refusals: dirty, detached, base branch, checked out on the host", () => {
	assert.match(
		landRefusal({ branch: "f", dirty: 2 }, [], "origin/main")!,
		/2 uncommitted/,
	);
	assert.match(
		landRefusal({ branch: "", dirty: 0 }, [], "origin/main")!,
		/detached/,
	);
	assert.match(
		landRefusal({ branch: "main", dirty: 0 }, [], "origin/main")!,
		/base branch/,
	);
	assert.match(
		landRefusal({ branch: "f", dirty: 0 }, ["main", "f"], "origin/main")!,
		/checked out/,
	);
	assert.equal(
		landRefusal({ branch: "f", dirty: 0 }, ["main"], "origin/main"),
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

type Entry = {
	repo: string;
	name: string;
	base: string;
	baseSha: string;
	branch: string;
	workspace: string;
	served: string;
};

function fixture(
	t: TestContext,
	names: string[],
	{ owner = "me", manifest = true } = {},
) {
	const root = mkdtempSync(join(tmpdir(), "fleet-land-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const key = join(root, "key");
	execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "fixture", "-f", key]);
	writeFileSync(
		join(root, "allowed"),
		`fixture@example.invalid ${readFileSync(`${key}.pub`, "utf8")}`,
	);
	const signer = join(root, "sign.sh");
	writeFileSync(
		signer,
		`#!/bin/sh
case " $* " in *" -Y sign "*)
  if [ -e "${root}/decline" ]; then
    left=$(cat "${root}/decline")
    if [ "$left" -le 0 ]; then rm "${root}/decline"; exit 1; fi
    echo $((left - 1)) > "${root}/decline"
  fi
  echo signed >> "${root}/signatures";;
esac
exec ssh-keygen "$@"
`,
	);
	chmodSync(signer, 0o755);
	writeFileSync(
		join(root, "gitconfig"),
		`[user]\n\tname = fixture\n\temail = fixture@example.invalid\n\tsigningkey = ${key}\n[gpg]\n\tformat = ssh\n[gpg "ssh"]\n\tprogram = ${signer}\n\tallowedSignersFile = ${join(root, "allowed")}\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n`,
	);
	const env = {
		...process.env,
		GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
		GIT_CONFIG_NOSYSTEM: "1",
	};
	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", ["-C", cwd, ...args], {
			encoding: "utf8",
			env,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	const commit = (cwd: string, message: string, ...flags: string[]) => {
		writeFileSync(join(cwd, `${message.replace(/\W+/g, "-")}.txt`), message);
		git(cwd, "add", "-A");
		git(cwd, "commit", "--quiet", ...flags, "-m", message);
		return git(cwd, "rev-parse", "HEAD");
	};
	const primary = join(root, "guest", names[0]);
	const guests: string[] = [];
	const repos: Entry[] = names.map((name, index) => {
		const origin = join(root, `origin-${name}.git`);
		execFileSync("git", ["init", "--quiet", "--bare", origin], { env });
		const host = join(root, "host", name);
		mkdirSync(dirname(host), { recursive: true });
		execFileSync("git", ["clone", "--quiet", origin, host], { env, stdio: "pipe" });
		commit(host, `base of ${name}`);
		git(host, "push", "--quiet", "origin", "main");
		git(host, "fetch", "--quiet", "origin");
		const guest = index === 0 ? primary : join(root, "ws", name);
		mkdirSync(dirname(guest), { recursive: true });
		if (index > 0) mkdirSync(join(primary, ".git", "fleet-repos"), { recursive: true });
		execFileSync(
			"git",
			[
				"clone",
				"--quiet",
				...(index > 0
					? ["--separate-git-dir", join(primary, ".git", "fleet-repos", `${name}.git`)]
					: []),
				origin,
				guest,
			],
			{ env, stdio: "pipe" },
		);
		git(guest, "switch", "--quiet", "-c", "task");
		commit(guest, `work in ${name}`);
		guests.push(guest);
		return {
			repo: host,
			name: `${owner}/${name}`,
			base: "main",
			baseSha: git(host, "rev-parse", "origin/main"),
			branch: "task",
			workspace: index === 0 ? host : guest,
			served: index === 0 ? "" : `/.git/fleet-repos/${name}.git`,
		};
	});
	git(repos[0].repo, "remote", "add", "sandbox-pi-a", primary);
	const io = fakeIo({ "read /root/host/repos.json": SAMPLE_PROFILES });
	io.home = root;
	io.tmp = root;
	if (manifest)
		io.files[`${root}/.fleet/config/fleet/pi-a.json`] = JSON.stringify({
			version: 1,
			task: `${root}/.fleet/tasks/${names[0]}/pi-a`,
			repositories: repos,
		});
	io.git = (args, cwd, opts) => {
		io.calls.push(["git", cwd, ...args]);
		return execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			env: { ...env, ...opts?.env },
			input: opts?.input ?? "",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	};
	const inGuest = (arg: string) => (arg === repos[0].repo ? primary : arg);
	io.sbx = (args) => {
		io.calls.push(["sbx", ...args]);
		if (args[0] === "ls")
			return JSON.stringify({
				sandboxes: [
					{ name: "pi-a", agent: "pi", status: "running", workspaces: [repos[0].repo] },
				],
			});
		if (args[0] !== "exec" || args[2] === "true") return "";
		const [command, ...rest] = args.slice(2).map(inGuest);
		return execFileSync(command, rest, {
			encoding: "utf8",
			env: { ...env, WORKSPACE_DIR: primary },
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	};
	const signatures = () =>
		existsSync(join(root, "signatures"))
			? readFileSync(join(root, "signatures"), "utf8").split("\n").filter(Boolean)
					.length
			: 0;
	const decline = (after: number) =>
		writeFileSync(join(root, "decline"), String(after));
	const landed = (index: number) =>
		git(
			repos[index].repo,
			"rev-parse",
			`refs/fleet/pi-a/${names[index]}/landed`,
		);
	const tip = (index: number) => git(repos[index].repo, "rev-parse", "refs/heads/task");
	const verdict = (index: number) =>
		git(repos[index].repo, "log", "--format=%G?", "origin/main..refs/heads/task");
	const absent = (index: number) =>
		assert.throws(() =>
			git(repos[index].repo, "show-ref", "--verify", "refs/heads/task"),
		);
	const input = (flags: { sign?: boolean; push?: boolean; branch?: string } = {}) => ({
		sandbox: "pi-a",
		repo: repos[0].repo,
		root: "/root",
		...flags,
	});
	return {
		root,
		io,
		git,
		commit,
		repos,
		guests,
		signatures,
		decline,
		landed,
		tip,
		verdict,
		absent,
		input,
	};
}

test("a signature declined on the second repository resumes on rerun without asking the first again", (t) => {
	const f = fixture(t, ["one", "two"]);
	f.decline(1);

	assert.throws(() => land(f.input(), f.io));
	assert.equal(f.signatures(), 1);

	land(f.input(), f.io);

	assert.equal(f.signatures(), 2);
	assert.equal(f.verdict(0), "G");
	assert.equal(f.verdict(1), "G");
	for (const index of [0, 1])
		assert.equal(f.landed(index), f.git(f.guests[index], "rev-parse", "HEAD"));
});

test("two repositories land through the daemon into their branches and anchors without touching a host checkout", (t) => {
	const f = fixture(t, ["one", "two"], { owner: "acme" });

	land(f.input(), f.io);

	for (const index of [0, 1]) {
		const head = f.git(f.guests[index], "rev-parse", "HEAD");
		assert.equal(f.tip(index), head);
		assert.equal(f.landed(index), head);
		assert.equal(f.git(f.repos[index].repo, "branch", "--show-current"), "main");
		assert.equal(f.git(f.repos[index].repo, "status", "--porcelain"), "");
	}
	assert.equal(f.signatures(), 0);
	assert.ok(f.io.lines.some((line) => /--sign/.test(line)));
});

test("a container commit after a signed land is re-created alone on the signed branch", (t) => {
	const f = fixture(t, ["one", "two"]);
	land(f.input(), f.io);
	const signed = f.tip(0);
	const next = f.commit(f.guests[0], "more work in one");

	land(f.input(), f.io);

	assert.equal(f.signatures(), 3);
	assert.equal(f.git(f.repos[0].repo, "rev-parse", "refs/heads/task^"), signed);
	assert.equal(f.landed(0), next);
	assert.equal(
		f.git(f.repos[0].repo, "rev-parse", "refs/heads/task^{tree}"),
		f.git(f.guests[0], "rev-parse", "HEAD^{tree}"),
	);
	assert.equal(f.verdict(0), "G\nG");
});

test("a container an older fleet landed with signing resumes from the sandbox mirror", (t) => {
	const f = fixture(t, ["one"]);
	land(f.input(), f.io);
	const signed = f.tip(0);
	const before = f.landed(0);
	f.git(f.repos[0].repo, "update-ref", "-d", "refs/fleet/pi-a/one/landed");
	f.git(f.repos[0].repo, "update-ref", "refs/sandboxes/pi-a/task", before);
	const next = f.commit(f.guests[0], "more work in one");

	land(f.input(), f.io);

	assert.equal(f.git(f.repos[0].repo, "rev-parse", "refs/heads/task^"), signed);
	assert.equal(f.landed(0), next);
	assert.equal(f.verdict(0), "G\nG");
});

test("a sandbox mirror that moved past what was landed is no anchor", (t) => {
	const f = fixture(t, ["one"]);
	land(f.input(), f.io);
	const signed = f.tip(0);
	f.git(f.repos[0].repo, "update-ref", "-d", "refs/fleet/pi-a/one/landed");
	const next = f.commit(f.guests[0], "more work in one");
	f.git(f.repos[0].repo, "fetch", "--quiet", "sandbox-pi-a", `+task:refs/sandboxes/pi-a/task`);
	f.commit(f.guests[0], "even more work in one");

	assert.throws(() => land(f.input(), f.io), /descends neither/);
	assert.equal(f.tip(0), signed);
	assert.equal(f.git(f.repos[0].repo, "rev-parse", "refs/sandboxes/pi-a/task"), next);
});

test("a push refused on the second repository resumes on rerun, never forced", (t) => {
	const f = fixture(t, ["one", "two"], { owner: "acme" });
	const hook = join(f.root, "origin-two.git", "hooks", "pre-receive");
	writeFileSync(hook, "#!/bin/sh\nexit 1\n");
	chmodSync(hook, 0o755);

	assert.throws(() => land(f.input({ push: true }), f.io), /two/);
	rmSync(hook);
	const before = f.io.calls.length;
	land(f.input({ push: true }), f.io);

	const pushes = f.io.calls
		.slice(before)
		.filter((call) => call[0] === "git" && call[2] === "push");
	assert.deepEqual(
		pushes.map((call) => call[1]),
		[f.repos[1].repo],
	);
	assert.ok(!f.io.calls.some((call) => call.some((part) => /force|^\+/.test(part) && call[2] === "push")));
	for (const index of [0, 1])
		assert.equal(
			f.git(join(f.root, `origin-${["one", "two"][index]}.git`), "rev-parse", "task"),
			f.tip(index),
		);
});

test("land refuses unrelated history in an extra repository before any branch moves", (t) => {
	const f = fixture(t, ["one", "two"], { owner: "acme" });
	f.git(f.guests[1], "checkout", "--quiet", "--orphan", "stray");
	f.commit(f.guests[1], "unrelated");
	f.git(f.guests[1], "branch", "--quiet", "-M", "stray", "task");

	assert.throws(() => land(f.input(), f.io), /two: .* does not descend from the recorded base/);

	f.absent(0);
	assert.ok(f.io.lines.some((line) => /^acme\/one: container [0-9a-f]{40}, host none/.test(line)));
});

test("land refuses a branch checked out in a host worktree before any branch moves", (t) => {
	const f = fixture(t, ["one", "two"], { owner: "acme" });
	f.git(f.repos[1].repo, "worktree", "add", "--quiet", "-b", "task", join(f.root, "wt"), "origin/main");

	assert.throws(() => land(f.input(), f.io), /two: task is checked out/);

	f.absent(0);
});

test("land refuses a dirty container or one on another branch before any branch moves", (t) => {
	const dirty = fixture(t, ["one", "two"], { owner: "acme" });
	writeFileSync(join(dirty.guests[1], "loose.txt"), "x");
	assert.throws(() => land(dirty.input(), dirty.io), /two: 1 uncommitted/);
	dirty.absent(0);

	const moved = fixture(t, ["one", "two"], { owner: "acme" });
	moved.git(moved.guests[1], "switch", "--quiet", "-c", "elsewhere");
	assert.throws(() => land(moved.input(), moved.io), /two: expected branch task, found elsewhere/);
	moved.absent(0);
});

test("a container resynced to the signed origin branch fast-forwards the host", (t) => {
	const f = fixture(t, ["one"]);
	land(f.input({ push: true }), f.io);
	const signed = f.tip(0);
	f.git(f.guests[0], "fetch", "--quiet", "origin");
	f.git(f.guests[0], "reset", "--quiet", "--hard", "origin/task");
	const next = f.commit(f.guests[0], "after resync");

	land(f.input(), f.io);

	assert.equal(f.git(f.repos[0].repo, "rev-parse", "refs/heads/task^"), signed);
	assert.equal(f.landed(0), next);
	assert.equal(f.verdict(0), "G\nG");
	assert.equal(f.signatures(), 2);
});

test("a sandbox without a manifest lands its probed branch through the same path", (t) => {
	const f = fixture(t, ["solo"], { manifest: false });

	land(f.input(), f.io);

	assert.equal(f.landed(0), f.git(f.guests[0], "rev-parse", "HEAD"));
	assert.equal(
		f.git(f.repos[0].repo, "rev-parse", "refs/heads/task^{tree}"),
		f.git(f.guests[0], "rev-parse", "HEAD^{tree}"),
	);
});

test("a merge commit is re-signed with its re-created parents and its own tree", (t) => {
	const f = fixture(t, ["one"]);
	const fork = f.git(f.guests[0], "rev-parse", "HEAD");
	f.git(f.guests[0], "switch", "--quiet", "-c", "side");
	f.commit(f.guests[0], "side work");
	f.git(f.guests[0], "switch", "--quiet", "task");
	f.commit(f.guests[0], "main line work");
	f.git(f.guests[0], "merge", "--quiet", "--no-ff", "-m", "merge side", "side");

	land(f.input(), f.io);

	const parents = f.git(f.repos[0].repo, "log", "-1", "--format=%P", "refs/heads/task").split(" ");
	const originals = f.git(f.guests[0], "log", "-1", "--format=%P", "HEAD").split(" ");
	assert.equal(parents.length, 2);
	for (const [index, parent] of parents.entries()) {
		assert.notEqual(parent, originals[index]);
		assert.equal(f.git(f.repos[0].repo, "log", "-1", "--format=%G?", parent), "G");
		assert.equal(
			f.git(f.repos[0].repo, "rev-parse", `${parent}^{tree}`),
			f.git(f.guests[0], "rev-parse", `${originals[index]}^{tree}`),
		);
	}
	assert.notEqual(f.git(f.repos[0].repo, "merge-base", parents[0], parents[1]), fork);
	assert.equal(
		f.git(f.repos[0].repo, "rev-parse", "refs/heads/task^{tree}"),
		f.git(f.guests[0], "rev-parse", "HEAD^{tree}"),
	);
	assert.equal(f.verdict(0), "G\nG\nG\nG");
});

test("a signed commit above an unsigned one is re-created with its author and date", (t) => {
	const f = fixture(t, ["one"]);
	const signedInside = f.commit(f.guests[0], "signed inside", "-S");
	const [author, date] = f
		.git(f.guests[0], "log", "-1", "--format=%an <%ae>%x00%ad", "--date=raw", signedInside)
		.split("\0");
	const asked = f.signatures();

	land(f.input(), f.io);

	assert.equal(f.signatures() - asked, 2);
	assert.equal(
		f.git(f.repos[0].repo, "log", "-1", "--format=%an <%ae>%x00%ad", "--date=raw", "refs/heads/task"),
		`${author}\0${date}`,
	);
	assert.equal(
		f.git(f.repos[0].repo, "log", "-1", "--format=%B", "refs/heads/task"),
		"signed inside",
	);
	assert.equal(f.verdict(0), "G\nG");
});

test("signing runs no hook of the host repository", (t) => {
	const f = fixture(t, ["one"]);
	for (const hook of ["pre-commit", "commit-msg", "post-commit", "post-rewrite"]) {
		const path = join(f.repos[0].repo, ".git", "hooks", hook);
		writeFileSync(path, `#!/bin/sh\ntouch "${f.root}/hook-ran"\n`);
		chmodSync(path, 0o755);
	}

	land(f.input(), f.io);

	assert.equal(f.verdict(0), "G");
	assert.ok(!existsSync(join(f.root, "hook-ran")));
});

test("a checkout whose directory name has a space lands into its branch", (t) => {
	const f = fixture(t, ["my app"], { owner: "acme" });

	land(f.input(), f.io);

	assert.equal(f.tip(0), f.git(f.guests[0], "rev-parse", "HEAD"));
});

test("every exit prints one line per repository with its container head, host branch, origin branch and signature", (t) => {
	const f = fixture(t, ["one", "two"]);

	land(f.input(), f.io);

	const heads = f.guests.map((guest) => f.git(guest, "rev-parse", "HEAD"));
	assert.deepEqual(
		f.io.lines.filter((line) => /: container /.test(line)),
		[0, 1].map(
			(index) =>
				`me/${["one", "two"][index]}: container ${heads[index]}, host ${f.tip(index)}, origin/task none, tip G`,
		),
	);
});

const multi = {
	version: 1,
	task: "/home/me/.fleet/tasks/r/pi-a",
	repositories: [
		{ repo: "/r", name: "acme/fe", base: "main", baseSha: "1".repeat(40), branch: "task", workspace: "/r", served: "" },
		{ repo: "/api", name: "acme/api", base: "main", baseSha: "2".repeat(40), branch: "task", workspace: "/tmp/fleet-repos/api", served: "/.git/fleet-repos/api.git" },
	],
};

test("--branch is refused once the repository has a landed anchor", (t) => {
	const f = fixture(t, ["one"], { owner: "acme" });
	land(f.input(), f.io);
	const landed = f.landed(0);
	f.git(f.guests[0], "switch", "--quiet", "-c", "other");
	f.commit(f.guests[0], "other work");

	assert.throws(
		() => land(f.input({ branch: "other" }), f.io),
		/acme\/one: .*refs\/fleet\/pi-a\/one\/landed.*recorded branch task/,
	);
	assert.equal(f.landed(0), landed);
	assert.throws(() => f.git(f.repos[0].repo, "show-ref", "--verify", "refs/heads/other"));
});

test("--branch names one repository's branch and is refused for several", () => {
	const io = fakeIo({
		"read /root/host/repos.json": SAMPLE_PROFILES,
		"read /home/me/.fleet/config/fleet/pi-a.json": JSON.stringify(multi),
	});

	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root", branch: "other" }, io),
		/--branch/,
	);
	assert.ok(!io.calls.some((call) => call[0] === "git" && call.includes("fetch")));
	assert.deepEqual(
		io.lines.filter((line) => /: container /.test(line)).map((line) => line.split(":")[0]),
		["acme/fe", "acme/api"],
	);
});

test("--push where a profile gives the host no push refuses before anything is fetched", () => {
	const io = fakeIo({
		"read /root/host/repos.json": JSON.stringify({
			...JSON.parse(SAMPLE_PROFILES),
			"acme/api": {
				...JSON.parse(SAMPLE_PROFILES)["acme/*"],
				host: { ...JSON.parse(SAMPLE_PROFILES)["acme/*"].host, push: "none" },
			},
		}),
		"read /home/me/.fleet/config/fleet/pi-a.json": JSON.stringify(multi),
	});

	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root", push: true }, io),
		/acme\/api: .*no push/,
	);
	assert.ok(!io.calls.some((call) => call[0] === "git" && call.includes("fetch")));
	assert.ok(!io.calls.some((call) => call[0] === "sbx"));
	assert.deepEqual(
		io.lines.filter((line) => /: container /.test(line)).map((line) => line.split(":")[0]),
		["acme/fe", "acme/api"],
	);
});
