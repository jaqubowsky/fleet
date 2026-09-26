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

test("the seed holds the project AGENTS.md, vision, board and the one ticket template", () => {
	assert.deepEqual(seedFiles, ["AGENTS.md", "spec/board.md", "spec/ticket.md", "spec/vision.md"]);
	assert.equal(readFileSync(join(seed, "spec/ticket.md"), "utf8"), readFileSync(join(root, "rules/refs/ticket.md"), "utf8"));
});

test("init on an empty repository lays out every seed file", (t) => {
	const { repo, io, lines } = scratch(t);
	init({ root, repo }, io);
	for (const file of seedFiles) {
		assert.equal(readFileSync(join(repo, file), "utf8"), readFileSync(join(seed, file), "utf8"), file);
		assert.ok(lines.some((line) => line.includes(`laid out ${file}`)), `no line for ${file}`);
	}
});

test("init on a populated repository leaves every existing file byte for byte", (t) => {
	const { repo, io, lines } = scratch(t);
	mkdirSync(join(repo, "spec"));
	writeFileSync(join(repo, "AGENTS.md"), "# Ours\n");
	writeFileSync(join(repo, "spec/board.md"), "## Now\n- 07\n");
	init({ root, repo }, io);
	assert.equal(readFileSync(join(repo, "AGENTS.md"), "utf8"), "# Ours\n");
	assert.equal(readFileSync(join(repo, "spec/board.md"), "utf8"), "## Now\n- 07\n");
	assert.equal(readFileSync(join(repo, "spec/vision.md"), "utf8"), readFileSync(join(seed, "spec/vision.md"), "utf8"));
	assert.ok(lines.includes("left AGENTS.md"));
	assert.ok(lines.includes("left spec/board.md"));
	assert.ok(lines.includes("laid out spec/ticket.md"));
});
