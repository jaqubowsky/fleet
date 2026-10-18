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
type Context = { cwd: string; hasUI: boolean; ui: { confirm(title: string, message: string): Promise<boolean> } };
type Handler = (event: { toolName: string; input: Record<string, unknown> }, ctx: Context) => Verdict | Promise<Verdict>;

function claude(tool: string, subject: string): string {
	return answer({ tool_name: tool, tool_input: input(tool, subject), cwd: CWD }, undefined, HOME);
}

function claudeVerdict(tool: string, subject: string): string {
	const out = claude(tool, subject);
	if (!OWN.test(out)) return "allow";
	return JSON.parse(out).hookSpecificOutput.permissionDecision;
}

async function pi(tool: string, subject: string, approve = false): Promise<{ verdict: Verdict; asked: string[] }> {
	let captured: Handler | undefined;
	guard(KINDS.pi, undefined, HOME)({ on: (_event, fn) => { captured = fn as Handler; } });
	const given = tool === "Bash" ? { command: subject } : { path: subject, content: "", oldText: "", newText: "" };
	const asked: string[] = [];
	const ui = { confirm: async (_title: string, message: string) => { asked.push(message); return approve; } };
	const verdict = await captured!({ toolName: tool.toLowerCase(), input: given }, { cwd: CWD, hasUI: true, ui });
	return { verdict, asked };
}

async function piVerdict(tool: string, subject: string): Promise<string> {
	const { verdict, asked } = await pi(tool, subject);
	if (asked.length) return "ask";
	return verdict && OWN.test(verdict.reason) ? "deny" : "allow";
}

test("both hooks refuse a write into either harness home, ask on a command they cannot read, and leave reads and runtime state alone", async () => {
	const wrong: string[] = [];
	for (const { want, tool, subject } of cases("cases-own-config.tsv")) {
		const got = { claude: claudeVerdict(tool, subject), pi: await piVerdict(tool, subject) };
		for (const [name, verdict] of Object.entries(got))
			if (verdict !== want) wrong.push(`${name}: ${want} expected, ${verdict} given: ${tool} ${subject}`);
	}

	assert.deepEqual(wrong, []);
});

test("the claude hook answers deny with the reason when it refuses a home write", () => {
	assert.match(claude("Edit", "~/.claude/settings.json"), /"permissionDecision":"deny"/);
});

test("a refusal names what a home write loses and where the change goes instead", () => {
	assert.match(claude("Edit", "~/.claude/settings.json"), /harness repo/);
});

test("a question names the reads that pass without one", async () => {
	const { verdict } = await pi("Bash", "sed -n 1p ~/.claude/settings.json");

	for (const reason of [claude("Bash", "find ~/.claude/skills -name SKILL.md"), verdict?.reason ?? ""])
		assert.match(reason, /Read, Grep and Glob tools.*cat.*readlink/);
});

test("pi runs a command the person approves", async () => {
	const { verdict, asked } = await pi("Bash", "git -C ~/.pi log", true);

	assert.equal(asked.length, 1);
	assert.equal(verdict, undefined);
});
