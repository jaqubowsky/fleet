import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fakeIo } from "../fleet/fake-io.ts";
import { realIo } from "../fleet/io.ts";
import { SEATS } from "../harness.ts";
import { SAMPLE_PROFILES } from "../profile/fixture.ts";
import { parity, VOCABULARY } from "./parity.ts";

const root = resolve(import.meta.dirname, "../..");

function sources(extra: Record<string, unknown>): Record<string, unknown> {
	return {
		"list /root/rules": ["core.md"],
		"read /root/rules/core.md": "# Core\n{{file:note}}\n",
		"read /root/fragments/note.md": "shared note\n",
		"read /root/sbx/container/sandbox.md": "# Container\nleaves at {{cli}} land\n",
		"read /root/agents/explorer.md": "---\nname: explorer\n---\n",
		"read /root/agents/researcher.md": "---\nname: researcher\n---\n",
		"read /root/agents/reviewer.md": "---\nname: reviewer\n---\n",
		"read /root/claude/CLAUDE.md": "Rules live in rules/.\n",
		"read /root/sbx/container/toolchain.Dockerfile": "RUN install node\n",
		"read /root/pi/sbx/Dockerfile": "FROM pi-base\n",
		"read /root/claude/sbx/Dockerfile": "FROM claude-base\n",
		"read /root/claude/sbx/stage.sh": "BUILD_ARGS+=(--build-arg X=1)\n",
		"read /root/host/repos.json": SAMPLE_PROFILES,
		...extra,
	};
}

test("the two harnesses render alike except where the list says why", () => {
	const result = parity(root, { ...realIo(root, SEATS.pi), log: () => {} });

	assert.deepEqual(result.unlisted, []);
	assert.deepEqual([...result.listed].filter(([, lines]) => lines === 0).map(([d]) => d.reason), []);
	assert.deepEqual([...result.listed.keys()].filter((d) => !d.reason || d.reason.includes("\n")), []);
	assert.deepEqual(VOCABULARY.filter(([, reason]) => !reason || reason.includes("\n")), []);
});

test("a harness text nobody listed fails the parity check", () => {
	const io = fakeIo(sources({ "read /root/pi/fragments/note.md": "a different note\n" }));

	const result = parity("/root", io);

	assert.deepEqual(result.unlisted, ["rules/core.md: a different note [pi]", "rules/core.md: shared note [claude]"]);
});

test("text from a harness's own directory with no shared source is that harness's", () => {
	const io = fakeIo(
		sources({
			"read /root/rules/core.md": "# Core\n{{file:own}}\n",
			"read /root/pi/fragments/own.md": "wait in a poll\n",
			"read /root/claude/fragments/own.md": "wait in the background\n",
			"read /root/claude/CLAUDE.md": "Rules live in rules/.\n",
		}),
	);

	const result = parity("/root", io);

	assert.deepEqual(result.unlisted, []);
});

test("a shared fragment every harness overrides is still compared", () => {
	const io = fakeIo(
		sources({
			"read /root/pi/fragments/note.md": "one note\n",
			"read /root/claude/fragments/note.md": "another note\n",
		}),
	);

	const result = parity("/root", io);

	assert.deepEqual(result.unlisted, ["rules/core.md: one note [pi]", "rules/core.md: another note [claude]"]);
});

test("an override that differs only in vocabulary is reported", () => {
	const io = fakeIo(sources({ "read /root/fragments/note.md": "run {{cli}} land\n", "read /root/pi/fragments/note.md": "run fleet land\n" }));

	const result = parity("/root", io);

	assert.deepEqual(result.unlisted, []);
	assert.deepEqual(result.overrides, ["pi/fragments/note.md matches fragments/note.md up to vocabulary (note.md)"]);
});
