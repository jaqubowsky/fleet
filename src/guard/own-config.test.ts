import assert from "node:assert/strict";
import { test } from "node:test";
import { answer } from "../../claude/hooks/guard.ts";
import guard from "../../extensions/guard.ts";
import { KINDS } from "../harness.ts";
import { cases, input } from "./corpus.ts";

const HOME = "/Users/alice";
const CWD = "/Users/alice/Work/app";
const OWN = /harness renders/;

type Verdict = { block: boolean; reason: string } | undefined;
type Handler = (event: { toolName: string; input: Record<string, unknown> }, ctx: { cwd: string }) => Verdict;

function claude(tool: string, subject: string): string {
	return answer({ tool_name: tool, tool_input: input(tool, subject), cwd: CWD }, undefined, HOME);
}

function pi(tool: string, subject: string): string {
	let captured: Handler | undefined;
	guard(KINDS.pi, undefined, HOME)({ on: (_event, fn) => { captured = fn as Handler; } });
	const given = tool === "Bash" ? { command: subject } : { path: subject, content: "", oldText: "", newText: "" };
	return captured!({ toolName: tool.toLowerCase(), input: given }, { cwd: CWD })?.reason ?? "";
}

test("both hooks refuse a write into either harness home and leave reads and runtime state alone", () => {
	const wrong = cases("cases-own-config.tsv").flatMap(({ want, tool, subject }) =>
		Object.entries({ claude, pi })
			.filter(([, hook]) => OWN.test(hook(tool, subject)) !== (want === "deny"))
			.map(([name]) => `${name}: ${want} expected: ${tool} ${subject}`),
	);

	assert.deepEqual(wrong, []);
});

test("the claude hook answers deny with the reason when it refuses a home write", () => {
	assert.match(claude("Edit", "~/.claude/settings.json"), /"permissionDecision":"deny"/);
});

test("a refusal names the reads that pass", () => {
	for (const reason of [claude("Bash", "find ~/.claude/skills -name SKILL.md"), pi("Bash", "sed -n 1p ~/.claude/settings.json")])
		assert.match(reason, /Read, Grep and Glob tools.*cat.*ls/);
});
