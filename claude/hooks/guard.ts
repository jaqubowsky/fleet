import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { downPermission, sandboxDownTarget } from "../../src/guard/down.ts";
import { landPermission } from "../../src/guard/land.ts";
import { hostAt } from "../../src/guard/host.ts";
import { OWN_CONFIG, writesOwnConfig } from "../../src/guard/own-config.ts";
import { decide, POLICY_TOOLS } from "../../src/guard/policy.ts";

type HookInput = {
	tool_name?: string;
	tool_input?: Record<string, unknown>;
	cwd?: string;
};

const POLICY = new RegExp(`^(${POLICY_TOOLS.join("|")})$`);
export function answer(
	input: HookInput,
	root?: string,
	home = homedir(),
	level = (sandbox: string) => sandboxDownTarget(sandbox, root, home),
): string {
	const tool = input.tool_name ?? "";
	if (!POLICY.test(tool)) return "";
	if (tool === "Bash") {
		const command = String(input.tool_input?.command ?? "");
		const landing = landPermission(command);
		if (landing)
			return JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: landing.decision,
					permissionDecisionReason: landing.reason,
				},
			});
		const down = downPermission(command, level);
		if (down)
			return JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: down.decision,
					permissionDecisionReason: down.reason,
				},
			});
	}
	const cwd = input.cwd ?? process.cwd();
	if (writesOwnConfig(tool, input.tool_input ?? {}, cwd, home))
		return JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: OWN_CONFIG,
			},
		});
	const verdict = decide(
		tool,
		input.tool_input ?? {},
		hostAt(cwd, root, home),
	);
	if (verdict.decision === "allow" && !verdict.explicit) return "";
	return JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: verdict.decision,
			permissionDecisionReason: verdict.reason,
		},
	});
}

if (import.meta.filename === process.argv[1]) {
	let input: HookInput;
	try {
		input = JSON.parse(readFileSync(0, "utf8")) as HookInput;
	} catch (cause) {
		throw new Error("Invalid guard tool input", { cause });
	}
	process.stdout.write(answer(input));
}
