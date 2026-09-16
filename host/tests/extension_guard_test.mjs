import assert from "node:assert/strict";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = join(tmpdir(), `pi-guard-test-${process.pid}`);
const guard = join(home, ".pi/host/hooks/guard.sh");

await mkdir(join(home, ".pi/host/hooks"), { recursive: true });
await writeFile(
	guard,
	`#!/usr/bin/env bash
payload="$(cat)"
case "$GUARD_BEHAVIOR" in
  allow) printf '%s\\n' '{"hookSpecificOutput":{"permissionDecision":"allow","permissionDecisionReason":"allowed"}}' ;;
  deny) printf '%s\\n' '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"denied"}}' ;;
  empty) exit 0 ;;
  error) exit 7 ;;
  invalid-json) printf '%s\\n' 'not-json' ;;
  invalid-decision) printf '%s\\n' '{"hookSpecificOutput":{}}' ;;
  policy)
    actual="$(printf '%s' "$payload" | jq -r '.tool_name')"
    subject="$(printf '%s' "$payload" | jq -r '[.tool_input | .. | strings] | join(" ")')"
    if [ "$actual" = "$EXPECTED_POLICY" ] && printf '%s' "$subject" | grep -Fq "$PROTECTED_PATH"; then
      printf '%s\\n' '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"protected"}}'
    else
      printf '%s\\n' '{"hookSpecificOutput":{"permissionDecision":"allow","permissionDecisionReason":"allowed"}}'
    fi ;;
esac
`,
);
await chmod(guard, 0o755);
process.env.HOME = home;

const { default: registerGuard } = await import(
	"../../agent/extensions/guard.ts"
);
let handler;
registerGuard({
	on(event, candidate) {
		assert.equal(event, "tool_call");
		handler = candidate;
	},
});
assert.equal(typeof handler, "function");

const failures = [];
let checks = 0;

async function check(name, test) {
	checks += 1;
	try {
		await test();
		process.stdout.write(`PASS  extension  ${name}\n`);
	} catch (error) {
		failures.push(name);
		process.stdout.write(`FAIL  extension  ${name}: ${error.message}\n`);
	}
}

const defaultInput = {
	command: "pwd",
	path: "README.md",
	pattern: "guard",
	url: "https://example.com",
	query: "pi guard",
};

async function call(toolName, input = defaultInput) {
	return handler({ toolName, input });
}

async function expectBlocked(toolName) {
	const result = await call(toolName);
	assert.equal(result?.block, true);
	assert.match(result.reason, /policy|unknown/i);
}

for (const behavior of ["error", "empty", "invalid-json", "invalid-decision"]) {
	await check(`${behavior} denies`, async () => {
		process.env.GUARD_BEHAVIOR = behavior;
		await expectBlocked("read");
	});
}

await check("valid deny blocks", async () => {
	process.env.GUARD_BEHAVIOR = "deny";
	const result = await call("read");
	assert.deepEqual(result, { block: true, reason: "denied" });
});

await check("unknown tool denies", async () => {
	process.env.GUARD_BEHAVIOR = "allow";
	await expectBlocked("unclassified_tool");
});

await check("unknown mcp-like tool denies", async () => {
	process.env.GUARD_BEHAVIOR = "allow";
	await expectBlocked("mcp_unclassified_tool");
});

const guarded = [
	"bash",
	"read",
	"edit",
	"write",
	"web_search",
	"source_check",
	"fetch_content",
	"get_search_content",
	"mcpScript",
	"mcp",
	"mcp__gateway",
	"mcp__context7",
	"subagent",
	"subagent_supervisor",
	"lens_diagnostics",
	"lsp_diagnostics",
	"symbol_search",
	"project_report",
	"module_report",
	"read_symbol",
	"read_enclosing",
	"ast_grep_search",
	"ast_grep_replace",
	"ast_grep_outline",
	"lsp_navigation",
	"lens_diagnostic_mark",
];

await check("guarded tools accept explicit allow", async () => {
	process.env.GUARD_BEHAVIOR = "allow";
	for (const toolName of guarded)
		assert.equal(await call(toolName), undefined, toolName);
});

const protectedPath = "/Users/alice/.ssh/id_ed25519";
const pathPolicies = [
	["module_report", { path: protectedPath }, "Read"],
	["read_symbol", { path: protectedPath }, "Read"],
	["read_enclosing", { path: protectedPath }, "Read"],
	["lsp_diagnostics", { paths: ["README.md", protectedPath] }, "Read"],
	["lens_diagnostics", { paths: ["README.md", protectedPath] }, "Read"],
	["symbol_search", { paths: ["README.md", protectedPath] }, "Read"],
	["ast_grep_search", { paths: ["README.md", protectedPath] }, "Read"],
	["ast_grep_outline", { paths: ["README.md", protectedPath] }, "Read"],
	["ast_grep_replace", { paths: ["README.md", protectedPath] }, "Edit"],
	["lsp_navigation", { operation: "definition", path: protectedPath }, "Read"],
	["lsp_navigation", { operation: "rename", path: protectedPath }, "Edit"],
	[
		"lens_diagnostic_mark",
		{ disposition: "defer", filePath: protectedPath },
		"Read",
	],
	[
		"lens_diagnostic_mark",
		{ disposition: "suppress", filePath: protectedPath },
		"Edit",
	],
];

await check("path tools use their read or edit policy", async () => {
	process.env.GUARD_BEHAVIOR = "policy";
	process.env.PROTECTED_PATH = protectedPath;
	for (const [toolName, input, policy] of pathPolicies) {
		process.env.EXPECTED_POLICY = policy;
		const result = await call(toolName, input);
		assert.deepEqual(
			result,
			{ block: true, reason: "protected" },
			`${toolName}:${policy}`,
		);
	}
});

await check("workspace tools guard their implicit path", async () => {
	process.env.GUARD_BEHAVIOR = "policy";
	process.env.PROTECTED_PATH = ".";
	for (const [toolName, input, policy] of [
		["lens_diagnostics", {}, "Read"],
		["lsp_diagnostics", {}, "Read"],
		["symbol_search", {}, "Read"],
		["ast_grep_search", {}, "Read"],
		["ast_grep_replace", {}, "Edit"],
	]) {
		process.env.EXPECTED_POLICY = policy;
		const result = await call(toolName, input);
		assert.deepEqual(
			result,
			{ block: true, reason: "protected" },
			`${toolName}:${policy}`,
		);
	}
});

await check("path and agent tools fail closed", async () => {
	process.env.GUARD_BEHAVIOR = "error";
	for (const [toolName, input] of pathPolicies) {
		const result = await call(toolName, input);
		assert.equal(result?.block, true, toolName);
	}
	for (const toolName of [
		"subagent",
		"subagent_supervisor",
		"project_report",
	]) {
		const result = await call(toolName);
		assert.equal(result?.block, true, toolName);
	}
});

const trusted = [
	"bg_wait",
	"ask_user_question",
	"pi_lens_activate_tools",
	"ast_grep_dump",
];

await check("non-access tools bypass guard failure", async () => {
	process.env.GUARD_BEHAVIOR = "error";
	for (const toolName of trusted)
		assert.equal(await call(toolName), undefined, toolName);
});

await rm(home, { recursive: true });
process.stdout.write(
	`extension guard: ${checks - failures.length} passed, ${failures.length} failed\n`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
