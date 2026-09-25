import { readFileSync } from "node:fs";
import { hostAt } from "../../src/guard/host.ts";
import { decide, POLICY_TOOLS } from "../../src/guard/policy.ts";

type HookInput = { tool_name?: string; tool_input?: Record<string, unknown>; cwd?: string };

const POLICY = new RegExp(`^(${POLICY_TOOLS.join("|")})$`);

export function answer(input: HookInput, root?: string): string {
	const tool = input.tool_name ?? "";
	if (!POLICY.test(tool)) return "";
	const verdict = decide(tool, input.tool_input ?? {}, hostAt(input.cwd ?? process.cwd(), root));
	if (verdict.decision === "allow" && !verdict.explicit) return "";
	return JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason } });
}

if (import.meta.filename === process.argv[1]) process.stdout.write(answer(JSON.parse(readFileSync(0, "utf8")) as HookInput));
