import { readFileSync } from "node:fs";
import { hostAt } from "../../src/guard/host.ts";
import { commandsOf, type Decision, decide, POLICY_TOOLS } from "../../src/guard/policy.ts";

type HookInput = { tool_name?: string; tool_input?: Record<string, unknown>; cwd?: string };

const POLICY = new RegExp(`^(${POLICY_TOOLS.join("|")})$`);
const EXCLUDED: string[] = JSON.parse(readFileSync(new URL("../managed-settings.json", import.meta.url), "utf8")).sandbox.excludedCommands.map((pattern: string) => pattern.replace(/\*$/, ""));
const SANDBOXED_READ = /^gh (pr (view|checks|list)|run list)$/;
const BARE_ONLY = EXCLUDED.filter((command) => !SANDBOXED_READ.test(command));
const BARE_ONLY_NAMES = BARE_ONLY.map((command) => command.split(" ").join("\\s+")).join("|");
const PRIVILEGED = new RegExp(`(^|[^\\w-])(${BARE_ONLY_NAMES})(?![\\w-])`);
const BARE = new RegExp(`^\\s*(${BARE_ONLY_NAMES})(?![\\w-])[^|;&<>()\\n]*$`);
const QUOTED = /'[^']*'|"(\\.|[^"\\])*"/g;
const NOT_BARE = `The sandbox exclusion matches a privileged command (${BARE_ONLY.join(", ")}) only when it is the whole command, so this one would run inside the sandbox and fail. Run it bare, on one line: its own name first, with no path, env or command before it, no pipe, redirect, &&, ;, parenthesis or newline around it, no newline inside its arguments, and any other step as its own call.`;

function privilegedNotBare(command: string): boolean {
	return commandsOf(command).some((segment) => PRIVILEGED.test(segment.replace(QUOTED, ""))) && !BARE.test(command.replace(QUOTED, (quoted) => (quoted.includes("\n") ? "\n" : "")));
}

export function answer(input: HookInput, root?: string): string {
	const tool = input.tool_name ?? "";
	if (!POLICY.test(tool)) return "";
	const decided = decide(tool, input.tool_input ?? {}, hostAt(input.cwd ?? process.cwd(), root));
	const verdict: Decision = decided.decision === "allow" && tool === "Bash" && privilegedNotBare(String(input.tool_input?.command)) ? { decision: "deny", reason: NOT_BARE } : decided;
	if (verdict.decision === "allow" && !verdict.explicit) return "";
	return JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason } });
}

if (import.meta.filename === process.argv[1]) process.stdout.write(answer(JSON.parse(readFileSync(0, "utf8")) as HookInput));
