import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { layerSources, misplaced } from "./layers.ts";

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
	assert.deepEqual(atSeededLine("skills/container/tdd/SKILL.md", "Then run skill `implement` and write `status.md`."), [{ names: "implement, status.md", owner: "sbx/container/sandbox.md" }]);
});

test("a host skill naming a mechanic belongs to the host owner", () => {
	assert.deepEqual(atSeededLine("skills/host/brain-dump/SKILL.md", "Tell the host to run {{cli}} land."), [{ names: "{{cli}}, the host", owner: "skills/host/orchestrating-agent-sessions/SKILL.md" }]);
});

test("a principle naming a mechanic belongs to a seat owner", () => {
	assert.deepEqual(atSeededLine("rules/core.md", "9. Blocked -> write it in `attention:`"), [{ names: "attention:", owner: "sbx/container/sandbox.md or skills/host/orchestrating-agent-sessions/SKILL.md" }]);
});

test("a contract naming a skill belongs to the container owner", () => {
	assert.deepEqual(atSeededLine("rules/refs/ticket.md", "A ticket is written by skill `to-tickets`."), [{ names: "to-tickets", owner: "sbx/container/sandbox.md" }]);
});

test("a skill keeps its own output file by name", () => {
	assert.deepEqual(atSeededLine("skills/container/to-tickets/SKILL.md", "Update `spec.md` when a decision changes."), []);
});
