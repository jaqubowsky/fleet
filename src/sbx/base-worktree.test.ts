import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = new URL("../../sbx/container/base-worktree.sh", import.meta.url).pathname;

function repo(ignore: string): { root: string; dest: string } {
	const dir = mkdtempSync(join(tmpdir(), "bw-"));
	const root = join(dir, "root");
	const dest = join(dir, "dest");
	mkdirSync(root);
	mkdirSync(dest);
	writeFileSync(join(root, ".gitignore"), ignore);
	const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8" });
	assert.equal(init.status, 0, init.stderr);
	return { root, dest };
}

function linkIgnored(root: string, dest: string): void {
	const run = spawnSync("bash", ["-c", 'source "$0" && link_ignored "$1" "$2"', script, root, dest], { encoding: "utf8" });
	assert.equal(run.status, 0, run.stderr);
}

test("an ignored directory nested in an untracked one links once and leaves the source tree intact", () => {
	const { root, dest } = repo("apps/api/src/generated/prisma/\n");
	mkdirSync(join(root, "apps/api/src/generated/prisma"), { recursive: true });
	writeFileSync(join(root, "apps/api/src/generated/prisma/index.js"), "client");
	writeFileSync(join(root, "apps/api/src/index.ts"), "tracked");
	spawnSync("git", ["-C", root, "add", "apps/api/src/index.ts"]);

	linkIgnored(root, dest);

	assert.equal(readFileSync(join(root, "apps/api/src/generated/prisma/index.js"), "utf8"), "client");
	assert.ok(!lstatSync(join(root, "apps/api/src/generated/prisma")).isSymbolicLink());
	assert.equal(readlinkSync(join(dest, "apps/api/src/generated")), join(root, "apps/api/src/generated"));
	assert.equal(readFileSync(join(dest, "apps/api/src/generated/prisma/index.js"), "utf8"), "client");
});

test("sibling ignored paths each get their own link and tracked files stay out", () => {
	const { root, dest } = repo("node_modules/\n.env\n");
	mkdirSync(join(root, "node_modules/x"), { recursive: true });
	writeFileSync(join(root, ".env"), "secret");
	writeFileSync(join(root, "a.ts"), "tracked");
	spawnSync("git", ["-C", root, "add", "a.ts"]);

	linkIgnored(root, dest);

	assert.equal(readlinkSync(join(dest, "node_modules")), join(root, "node_modules"));
	assert.equal(readlinkSync(join(dest, ".env")), join(root, ".env"));
	assert.throws(() => lstatSync(join(dest, "a.ts")));
});
