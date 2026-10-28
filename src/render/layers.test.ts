import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { containerTexts, hostChecks, layerSources, misplaced } from "./layers.ts";

const root = resolve(import.meta.dirname, "../..");

function atSeededLine(file: string, line: string) {
	const sources = layerSources(root);
	const at = `${file}:${sources[file].split("\n").length}`;
	return misplaced({ ...sources, [file]: `${sources[file]}${line}\n` })
		.filter((row) => row.at === at)
		.map(({ names, owner }) => ({ names, owner }));
}

test("every line in skills, principles and refs sits in its own layer", () => {
	assert.deepEqual(misplaced(layerSources(root)), []);
});

test("a container skill naming another skill or a mechanic belongs to the container owner", () => {
	assert.deepEqual(atSeededLine("skills/container/babysit-pr/SKILL.md", "Then run skill `analyze-task` and write `analysis.md`."), [{ names: "analyze-task, analysis.md", owner: "sbx/container/sandbox.md or skills/container/deliver-ticket/SKILL.md" }]);
	assert.deepEqual(atSeededLine("skills/container/babysit-pr/SKILL.md", "Then read `project.md`."), [{ names: "project.md", owner: "sbx/container/sandbox.md or skills/container/deliver-ticket/SKILL.md" }]);
});

test("a host skill naming a mechanic belongs to the host owner", () => {
	assert.deepEqual(atSeededLine("skills/host/brain-dump/SKILL.md", "Tell the host to run {{cli}} land."), [{ names: "{{cli}}, the host", owner: "skills/host/orchestrating-agent-sessions/SKILL.md" }]);
});

test("a principle naming a mechanic belongs to a seat owner", () => {
	assert.deepEqual(atSeededLine("rules/core.md", "9. Blocked -> write it in `analysis.md`"), [{ names: "analysis.md", owner: "sbx/container/sandbox.md or skills/container/deliver-ticket/SKILL.md or skills/host/orchestrating-agent-sessions/SKILL.md" }]);
});

test("a principle naming a skill one seat lacks belongs to a seat owner", () => {
	assert.deepEqual(atSeededLine("rules/core.md", "9. A red check on the pull request -> skill `babysit-pr`"), [{ names: "babysit-pr", owner: "sbx/container/sandbox.md or skills/container/deliver-ticket/SKILL.md or skills/host/orchestrating-agent-sessions/SKILL.md" }]);
	assert.deepEqual(atSeededLine("rules/delegation.md", "4. Reviewing a diff -> skill `two-axis-review`"), []);
});

test("a contract naming a skill belongs to the container owner", () => {
	assert.deepEqual(atSeededLine("rules/refs/ticket.md", "A ticket is written by skill `to-tickets`."), [{ names: "to-tickets", owner: "sbx/container/sandbox.md or skills/container/deliver-ticket/SKILL.md" }]);
});

test("no text a container reads names a check the host runs after it", () => {
	assert.deepEqual(hostChecks(containerTexts(root)), []);
});

test("a container line naming the host's acceptance or review is found with its file and line", () => {
	assert.deepEqual(hostChecks({ "claude/home/rules/sandbox.md": "1. Commit\n2. Skip review: the host reviews independently\n", "pi/home/agent/refs/artifacts.md": "ticket.md  the host's acceptance lands in the tracker issue\n" }), [
		"claude/home/rules/sandbox.md:2",
		"pi/home/agent/refs/artifacts.md:1",
	]);
});
