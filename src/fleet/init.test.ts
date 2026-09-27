import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { type TestContext, test } from "node:test";
import { HARNESSES } from "../harness.ts";
import { init } from "./init.ts";
import { realIo } from "./io.ts";

const root = resolve(import.meta.dirname, "../..");
const seed = join(root, "templates/project");
const seedFiles = readdirSync(seed, { withFileTypes: true, recursive: true })
	.filter((entry) => !entry.isDirectory())
	.map((entry) => relative(seed, join(entry.parentPath, entry.name)))
	.sort();

function scratch(t: TestContext): { repo: string; io: ReturnType<typeof realIo>; lines: string[] } {
	const repo = mkdtempSync(join(tmpdir(), "init-"));
	t.after(() => rmSync(repo, { recursive: true, force: true }));
	const lines: string[] = [];
	return { repo, io: { ...realIo(repo, HARNESSES.claude), log: (line: string) => lines.push(line) }, lines };
}

test("init on an empty repository lays out the product seed and nothing else", (t) => {
	const { repo, io, lines } = scratch(t);
	init({ root, repo }, io);
	const laid = readdirSync(repo, { withFileTypes: true, recursive: true })
		.filter((entry) => !entry.isDirectory())
		.map((entry) => relative(repo, join(entry.parentPath, entry.name)))
		.sort();
	assert.deepEqual(laid, ["AGENTS.md", "spec/vision.md"]);
	for (const file of seedFiles) {
		assert.equal(readFileSync(join(repo, file), "utf8"), readFileSync(join(seed, file), "utf8"), file);
		assert.ok(lines.some((line) => line.includes(`laid out ${file}`)), `no line for ${file}`);
	}
});

test("init on a populated repository leaves every existing file byte for byte", (t) => {
	const { repo, io, lines } = scratch(t);
	mkdirSync(join(repo, "spec"));
	writeFileSync(join(repo, "AGENTS.md"), "# Ours\n");
	writeFileSync(join(repo, "spec/vision.md"), "# Ours too\n");
	init({ root, repo }, io);
	assert.equal(readFileSync(join(repo, "AGENTS.md"), "utf8"), "# Ours\n");
	assert.equal(readFileSync(join(repo, "spec/vision.md"), "utf8"), "# Ours too\n");
	assert.deepEqual(lines, ["left AGENTS.md", "left spec/vision.md"]);
});

test("the seed AGENTS.md sends work to the tracker the project overlay names", () => {
	const agents = readFileSync(join(seed, "AGENTS.md"), "utf8");
	assert.match(agents, /tracker/);
	assert.match(agents, /`project\.md`/);
	assert.doesNotMatch(agents, /spec\/board\.md|spec\/tickets|spec\/ticket\.md/);
});
