import { readFileSync } from "node:fs";
import { decide } from "../../src/guard/policy.ts";

type HookInput = { tool_name?: string; tool_input?: Record<string, unknown> };

export function answer(input: HookInput): string {
	const verdict = decide(input.tool_name ?? "", input.tool_input ?? {});
	if (verdict.decision === "allow" && !verdict.explicit) return "";
	return JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason } });
}

if (import.meta.filename === process.argv[1]) process.stdout.write(answer(JSON.parse(readFileSync(0, "utf8")) as HookInput));
