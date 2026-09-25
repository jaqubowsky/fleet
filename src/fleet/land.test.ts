import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeIo } from "./fake-io.ts";
import { REAL_PROFILES } from "../profile/fixture.ts";
import { baseBranch, isBase, land, landRefusal } from "./land.ts";

test("refusals: dirty, detached, base branch, checked out locally", () => {
	assert.match(landRefusal({ branch: "f", dirty: 2 }, "main", "origin/main")!, /2 uncommitted/);
	assert.match(landRefusal({ branch: "", dirty: 0 }, "main", "origin/main")!, /detached/);
	assert.match(landRefusal({ branch: "main", dirty: 0 }, "dev", "origin/main")!, /base branch/);
	assert.match(landRefusal({ branch: "f", dirty: 0 }, "f", "origin/main")!, /checked out/);
	assert.equal(landRefusal({ branch: "f", dirty: 0 }, "main", "origin/main"), undefined);
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
	const noHead = fakeIo({ "git rev-parse --verify --quiet origin/HEAD": new Error("no"), "git rev-parse --verify --quiet origin/main": new Error("no"), "git rev-parse --verify --quiet origin/master": new Error("no") });
	assert.equal(baseBranch("/r", noHead), "main");
});

const probe = 'sbx exec pi-a sh -c cd "$WORKSPACE_DIR" && printf';
const unsigning = { "read /root/host/repos.json": REAL_PROFILES, "git remote get-url origin": "git@github.com:acme/webapp.git" };

test("land fetches from the sandbox remote and stays unsigned where the profile gives host.sign none", () => {
	const io = fakeIo({ ...unsigning, [probe]: "web-1\t0\tabc", "git rev-parse --abbrev-ref origin/HEAD": "origin/main", "git branch --show-current": "main", "git --no-pager log": "abc N feat: x" });
	land({ sandbox: "pi-a", repo: "/r", root: "/root" }, io);
	assert.deepEqual(io.calls.find((c) => c[0] === "git" && c[2] === "fetch"), ["git", "/r", "fetch", "--quiet", "sandbox-pi-a", "web-1:web-1"]);
	assert.ok(!io.calls.some((c) => c[0] === "git" && c.includes("-S")));
	assert.ok(io.lines.some((l) => /--sign/.test(l)));
});

test("land refuses before touching the repo", () => {
	const dirty = fakeIo({ ...unsigning, [probe]: "web-1\t3\tabc", "git rev-parse --abbrev-ref origin/HEAD": "origin/main", "git branch --show-current": "main" });
	assert.throws(() => land({ sandbox: "pi-a", repo: "/r", root: "/root" }, dirty), /3 uncommitted/);
	assert.ok(!dirty.calls.some((c) => c[0] === "git" && c[2] === "fetch"));
	const onBase = fakeIo({ ...unsigning, [probe]: "main\t0\tabc", "git rev-parse --abbrev-ref origin/HEAD": "origin/main", "git branch --show-current": "dev" });
	assert.throws(() => land({ sandbox: "pi-a", repo: "/r", root: "/root" }, onBase), /main is the base branch/);
	assert.ok(!onBase.calls.some((c) => c[0] === "git" && c[2] === "fetch"));
});

test("land --sign amends the first commit and rebases the rest with -S, in a worktree under tmp", () => {
	const io = fakeIo({ ...unsigning, [probe]: "web-1\t0\tabc", "git rev-parse --abbrev-ref origin/HEAD": "origin/main", "git branch --show-current": "main", "git rev-list --reverse": "c1\nc2\nc3", "git rev-parse HEAD": "signed1" });
	land({ sandbox: "pi-a", repo: "/r", root: "/root", sign: true }, io);
	const gits = io.calls.filter((c) => c[0] === "git").map((c) => c.slice(2).join(" "));
	const add = gits.indexOf("worktree add --quiet --detach /tmp/fleet-sign-web-1 c1");
	assert.ok(add >= 0 && gits[add - 1] === "worktree prune" && gits[add - 2].startsWith("worktree remove --force /tmp/fleet-sign-web-1"));
	assert.equal(gits[add + 1], "-c core.hooksPath=/dev/null commit --quiet --amend --no-edit --no-verify --allow-empty -S");
	assert.ok(gits.some((g) => g.includes("rebase --quiet --onto signed1 c1 web-1 --exec")));
	assert.ok(gits.some((g) => g === "update-ref refs/heads/web-1 signed1"));
	assert.ok(gits.at(-1)!.startsWith("worktree remove"));
});

test("land --sign with nothing to sign touches no worktree, and a failed rebase aborts it", () => {
	const empty = fakeIo({ ...unsigning, [probe]: "web-1\t0\tabc", "git rev-parse --abbrev-ref origin/HEAD": "origin/main", "git branch --show-current": "main", "git rev-list --reverse": "" });
	land({ sandbox: "pi-a", repo: "/r", root: "/root", sign: true }, empty);
	assert.ok(!empty.calls.some((c) => c[0] === "git" && c[2] === "worktree"));

	const failing = fakeIo({ ...unsigning, [probe]: "web-1\t0\tabc", "git rev-parse --abbrev-ref origin/HEAD": "origin/main", "git branch --show-current": "main", "git rev-list --reverse": "c1\nc2", "git rev-parse HEAD": "s1", "git -c core.hooksPath=/dev/null rebase": new Error("gpg failed") });
	assert.throws(() => land({ sandbox: "pi-a", repo: "/r", root: "/root", sign: true }, failing), /gpg failed/);
	const gits = failing.calls.filter((c) => c[0] === "git").map((c) => c.slice(2).join(" "));
	assert.ok(gits.some((g) => g === "rebase --abort"));
	assert.ok(!gits.some((g) => g.startsWith("update-ref")));
	assert.ok(gits.at(-1)!.startsWith("worktree remove"));
});

const landed = { ...unsigning, [probe]: "web-1\t0\tabc", "git rev-parse --abbrev-ref origin/HEAD": "origin/main", "git branch --show-current": "main" };

test("land --sign signs only the commits origin does not have yet", () => {
	const io = fakeIo({ ...landed, "git rev-parse --verify --quiet origin/web-1": "tip", "git rev-list --reverse": "c1", "git rev-parse HEAD": "signed1" });
	land({ sandbox: "pi-a", repo: "/r", root: "/root", sign: true }, io);
	const gits = io.calls.filter((c) => c[0] === "git").map((c) => c.slice(2).join(" "));

	assert.ok(gits.includes("fetch --quiet origin web-1"));
	assert.ok(gits.includes("rev-list --reverse web-1 --not origin/main origin/web-1"));
});

test("land --sign takes the whole branch when origin has never seen it", () => {
	const io = fakeIo({ ...landed, "git rev-parse --verify --quiet origin/web-1": new Error("unknown revision"), "git rev-list --reverse": "c1", "git rev-parse HEAD": "signed1" });
	land({ sandbox: "pi-a", repo: "/r", root: "/root", sign: true }, io);
	const gits = io.calls.filter((c) => c[0] === "git").map((c) => c.slice(2).join(" "));

	assert.ok(gits.includes("rev-list --reverse web-1 --not origin/main"));
});

test("land --sign refreshes the base before it lists or counts the commits to sign", () => {
	const io = fakeIo({ ...landed, "git rev-parse --verify --quiet origin/web-1": new Error("unknown revision"), "git rev-list --reverse": "c1", "git rev-parse HEAD": "signed1" });

	land({ sandbox: "pi-a", repo: "/r", root: "/root", sign: true }, io);

	const gits = io.calls.filter((c) => c[0] === "git").map((c) => c.slice(2).join(" "));
	const refresh = gits.indexOf("fetch --quiet origin main");
	assert.ok(refresh >= 0);
	assert.ok(refresh < gits.findIndex((g) => g.startsWith("--no-pager log")));
	assert.ok(refresh < gits.findIndex((g) => g.startsWith("rev-list --reverse")));
});

test("land --push never forces, and a rejected push names whose command the force is", () => {
	const io = fakeIo(landed);
	land({ sandbox: "pi-a", repo: "/r", root: "/root", push: true }, io);
	const gits = io.calls.filter((c) => c[0] === "git").map((c) => c.slice(2).join(" "));

	assert.ok(gits.includes("push --quiet -u origin web-1"));
	assert.ok(!gits.some((g) => /force/.test(g)));

	const rejected = fakeIo({ ...landed, "git push": new Error("! [rejected] web-1 -> web-1 (non-fast-forward)") });
	assert.throws(() => land({ sandbox: "pi-a", repo: "/r", root: "/root", push: true }, rejected), /non-fast-forward[\s\S]*your own command/);
});

test("land without --sign or --push never touches the remote where the profile gives host.sign none", () => {
	const io = fakeIo(landed);
	land({ sandbox: "pi-a", repo: "/r", root: "/root" }, io);

	assert.ok(!io.calls.some((c) => c[0] === "git" && c.includes("origin") && (c.includes("fetch") || c.includes("push"))));
});

test("land refuses a container branch that no longer descends from the landed one", () => {
	const io = fakeIo({ ...landed, "git fetch --quiet sandbox-pi-a": new Error("! [rejected] web-1 -> web-1 (non-fast-forward)") });

	assert.throws(() => land({ sandbox: "pi-a", repo: "/r", root: "/root" }, io), /signatures included[\s\S]*reset --hard origin\/web-1/);
	assert.ok(!io.calls.some((c) => c[0] === "git" && c.includes("--no-pager")));
});

test("land passes a fetch that never reached the container through as it is", () => {
	const io = fakeIo({ ...landed, "git fetch --quiet sandbox-pi-a": new Error("fatal: unable to connect to 127.0.0.1: errno=Operation not permitted") });

	assert.throws(
		() => land({ sandbox: "pi-a", repo: "/r", root: "/root" }, io),
		(error: Error) => /unable to connect/.test(error.message) && !/descendant/.test(error.message),
	);
});

test("land signs where the profile gives the host sign human, without --sign", () => {
	const io = fakeIo({ ...landed, "git remote get-url origin": "git@github.com:alice/cv.git", "git rev-parse --verify --quiet origin/web-1": new Error("unknown revision"), "git rev-list --reverse": "c1", "git rev-parse HEAD": "signed1" });

	land({ sandbox: "pi-a", repo: "/r", root: "/root" }, io);

	assert.ok(io.calls.some((c) => c[0] === "git" && c.includes("-S")));
	assert.ok(io.lines.includes("1 commit(s) signed on web-1"));
});

test("land reads the profile before it imports anything", () => {
	const io = fakeIo({ ...landed, "read /root/host/repos.json": undefined });

	assert.throws(() => land({ sandbox: "pi-a", repo: "/r", root: "/root" }, io), /missing \/root\/host\/repos.json/);
	assert.ok(!io.calls.some((c) => c[0] === "git" && c[2] === "fetch"));
});

test("land --push refuses where the profile gives the host no push, before it imports anything", () => {
	const profiles = JSON.parse(REAL_PROFILES);
	profiles["acme/*"].host.push = "none";
	const io = fakeIo({ ...landed, "read /root/host/repos.json": JSON.stringify(profiles) });

	assert.throws(() => land({ sandbox: "pi-a", repo: "/r", root: "/root", push: true }, io), /host\.push is none/);
	assert.ok(!io.calls.some((c) => c[0] === "git" && (c[2] === "fetch" || c[2] === "push")));
});
