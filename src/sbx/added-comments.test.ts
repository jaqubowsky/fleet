import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

const script = new URL("../../sbx/container/added-comments.sh", import.meta.url)
	.pathname;

function branch(base: Record<string, string>, change: Record<string, string>) {
	const repo = mkdtempSync(join(tmpdir(), "added-comments-"));
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
	const write = (files: Record<string, string>) => {
		for (const [path, text] of Object.entries(files)) {
			mkdirSync(dirname(join(repo, path)), { recursive: true });
			writeFileSync(join(repo, path), text);
		}
	};
	git("init", "-q", "-b", "main");
	git("config", "user.email", "t@t");
	git("config", "user.name", "t");
	git("config", "commit.gpgsign", "false");
	write({ "keep.txt": "base\n", ...base });
	git("add", "-A");
	git("commit", "-qm", "base");
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	git("checkout", "-qb", "task");
	write(change);
	return { repo, git };
}

function addedComments(repo: string) {
	return spawnSync("bash", [script, "origin/main"], {
		cwd: repo,
		encoding: "utf8",
	});
}

test("a comment the branch committed is printed with its file and line", () => {
	const { repo, git } = branch(
		{ "src/flags.ts": "export const A = 1;\n" },
		{
			"src/flags.ts":
				"export const A = 1;\n\n// why B exists\nexport const B = 2;\n",
		},
	);
	git("commit", "-qam", "b");

	const run = addedComments(repo);

	assert.equal(run.stdout, "added src/flags.ts:3: // why B exists\n");
	assert.equal(run.status, 1);
});

test("a branch without comments prints nothing and exits 0", () => {
	const { repo } = branch(
		{ "src/flags.ts": "export const A = 1;\n" },
		{ "src/flags.ts": "export const A = 1;\nexport const B = 2;\n" },
	);

	const run = addedComments(repo);

	assert.equal(run.stdout, "");
	assert.equal(run.status, 0);
});

test("every line of a doc block counts, a css rule inside a template does not", () => {
	const { repo } = branch(
		{},
		{
			"src/print.ts": [
				"const css = `",
				"* { box-sizing: border-box; }",
				"`;",
				"/**",
				" * Reveals the screen.",
				" */",
				"export const B = css;",
				"",
			].join("\n"),
		},
	);

	const run = addedComments(repo);

	assert.equal(
		run.stdout,
		"added src/print.ts:4: /**\nadded src/print.ts:5:  * Reveals the screen.\nadded src/print.ts:6:  */\n",
	);
});

test("sql comments count except the section markers prisma generates", () => {
	const { repo } = branch(
		{},
		{
			"prisma/migrations/1_guard/migration.sql": [
				"-- CreateTable",
				'CREATE TABLE "a" (id int);',
				"-- The purge sets ledger_purge first.",
				"CREATE FUNCTION f() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;",
				"",
			].join("\n"),
		},
	);

	const run = addedComments(repo);

	assert.equal(
		run.stdout,
		"added prisma/migrations/1_guard/migration.sql:3: -- The purge sets ledger_purge first.\n",
	);
});

test("shell and python comments count, a shebang does not", () => {
	const { repo } = branch(
		{},
		{
			"bin/run.sh": "#!/usr/bin/env bash\n# start the stack\nexit 0\n",
			"tools/x.py": "import os\n    # fallback\n",
		},
	);

	const run = addedComments(repo);

	assert.equal(
		run.stdout,
		"added bin/run.sh:2: # start the stack\nadded tools/x.py:2:     # fallback\n",
	);
});

test("a jsx comment counts", () => {
	const { repo } = branch(
		{},
		{ "src/a.tsx": "export const A = () => (\n  <div>{/* tab */}</div>\n);\n  {/* panel */}\n" },
	);

	const run = addedComments(repo);

	assert.equal(run.stdout, "added src/a.tsx:4:   {/* panel */}\n");
});

test("a reworded comment from the base is printed as changed", () => {
	const { repo } = branch(
		{ "src/old.ts": "// totals in grosze\nexport const A = 1;\n" },
		{ "src/old.ts": "// totals in grosze, rounded half up\nexport const A = 1;\n" },
	);

	const run = addedComments(repo);

	assert.equal(run.stdout, "changed src/old.ts:1: // totals in grosze, rounded half up\n");
	assert.equal(run.status, 1);
});

test("a comment moved with its code to another file stays out", () => {
	const { repo, git } = branch(
		{ "src/old.ts": "export const A = 1;\n// the ERP books a resend twice\nexport const B = 2;\n" },
		{
			"src/old.ts": "export const A = 1;\n",
			"src/erp.ts": "// the ERP books a resend twice\nexport const B = 2;\n",
		},
	);
	git("add", "-A");

	const run = addedComments(repo);

	assert.equal(run.stdout, "");
});

test("markdown, yaml and lines in untouched code stay out", () => {
	const { repo, git } = branch(
		{ "src/old.ts": "// old note\nexport const A = 1;\n" },
		{
			"README.md": "# Title\n",
			".github/workflows/ci.yml": "# pinned\non: push\n",
			"src/old.ts": "// old note\nexport const A = 2;\n",
		},
	);
	git("commit", "-qam", "c");

	const run = addedComments(repo);

	assert.equal(run.stdout, "");
});
