import assert from "node:assert/strict";
import { test } from "node:test";
import { flags } from "./cli.ts";

test("flags: values, bare booleans, -- passthrough", () => {
	assert.deepEqual(
		flags(
			["x", "--repo", "/r", "--sign", "--", "npm", "--version"],
			["repo", "sign"],
		),
		{ opts: { repo: "/r", sign: true }, rest: ["x", "npm", "--version"] },
	);
});

test("up keeps both repository paths in their given order", () => {
	assert.deepEqual(
		flags(["task", "--repo", "/fe", "--repo", "/api"], ["repo"]),
		{ opts: { repo: ["/fe", "/api"] }, rest: ["task"] },
	);
});

test("up retains two bases in repository order", () => {
	assert.deepEqual(
		flags(
			[
				"task",
				"--repo",
				"/one",
				"--base",
				"main",
				"--repo",
				"/two",
				"--base",
				"dev",
			],
			["repo", "base"],
		),
		{
			opts: { repo: ["/one", "/two"], base: ["main", "dev"] },
			rest: ["task"],
		},
	);
});

test("a value flag without a value is an error, never true", () => {
	assert.throws(
		() => flags(["x", "--branch"], ["branch"]),
		/missing value for --branch/,
	);
	assert.throws(
		() => flags(["x", "--branch", "--memory", "8g"], ["branch", "memory"]),
		/missing value for --branch/,
	);
});

test("an option the command does not take is refused instead of ignored", () => {
	assert.throws(() => flags(["--help"], []), /unknown option --help/);
	assert.throws(
		() => flags(["--repo", "/r"], ["lines"]),
		/unknown option --repo/,
	);
});

test("the usage names the two files init lays out", () => {
	assert.throws(
		() => flags(["--nope"], []),
		(error: Error) => {
			const line = error.message
				.split("\n")
				.find((row) => row.includes(" init <repo>"));
			assert.ok(line, "usage has an init line");
			assert.match(line, /AGENTS\.md, spec\/vision\.md;/);
			assert.doesNotMatch(line, /board|ticket/);
			return true;
		},
	);
});

test("the up usage starts the container's agent, the seat's own without a kind flag", () => {
	assert.throws(
		() => flags(["--nope"], []),
		(error: Error) => {
			const line = error.message
				.split("\n")
				.find((row) => row.includes(" up <label>"));
			assert.ok(line, "usage has an up line");
			assert.match(
				line,
				/start the container's agent in a herdr tab, the seat's own without --pi\|--claude/,
			);
			assert.doesNotMatch(line, /start pi/);
			return true;
		},
	);
});

test("the usage names the two hosts profile --apply configures from a plain shell", () => {
	assert.throws(
		() => flags(["--nope"], []),
		(error: Error) => {
			const profile = error.message
				.split("\n")
				.find((line) => line.includes(" profile [<repo>]"));
			assert.match(profile ?? "", /both pi and Claude.*plain shell/);
			const naming = error.message
				.split("\n")
				.filter(
					(line) =>
						/(?<![.\w/-])(pi|claude)(?![\w/-])/i.test(
							line.replaceAll("--pi|--claude", ""),
						) && !/ build | profile /.test(line),
				);
			assert.deepEqual(naming, []);
			return true;
		},
	);
});
