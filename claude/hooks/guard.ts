import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { downPermission, sandboxDownTarget } from "../../src/guard/down.ts";
import { fetchQuestion } from "../../src/guard/fetch.ts";
import { landPermission } from "../../src/guard/land.ts";
import { hostAt } from "../../src/guard/host.ts";
import { OWN_CONFIG, OWN_CONFIG_UNREAD, ownConfig } from "../../src/guard/own-config.ts";
import { decide, POLICY_TOOLS } from "../../src/guard/policy.ts";

type HookInput = {
	tool_name?: string;
	tool_input?: Record<string, unknown>;
	cwd?: string;
};

const POLICY = new RegExp(`^(${POLICY_TOOLS.join("|")})$`);

function asPolicyCall(input: HookInput): HookInput {
	if (input.tool_name !== "Monitor") return input;
	const ws = input.tool_input?.ws as { url?: unknown } | undefined;
	return ws
		? { ...input, tool_name: "WebFetch", tool_input: { url: String(ws.url ?? "") } }
		: { ...input, tool_name: "Bash", tool_input: { command: String(input.tool_input?.command ?? "") } };
}

export function answer(
	given: HookInput,
	root?: string,
	home = homedir(),
	level = (sandbox: string) => sandboxDownTarget(sandbox, root, home),
): string {
	const input = asPolicyCall(given);
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
	const homeWrite = ownConfig(tool, input.tool_input ?? {}, cwd, home);
	if (homeWrite)
		return JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: homeWrite,
				permissionDecisionReason: homeWrite === "deny" ? OWN_CONFIG : OWN_CONFIG_UNREAD,
			},
		});
	const verdict = decide(
		tool,
		input.tool_input ?? {},
		hostAt(cwd, root, home),
	);
	const question =
		verdict.decision === "allow" && tool === "Bash"
			? fetchQuestion(String(input.tool_input?.command ?? ""))
			: undefined;
	if (question)
		return JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "ask",
				permissionDecisionReason: question,
			},
		});
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
