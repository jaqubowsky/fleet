import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

type ToolCallEvent = { toolName: string; input?: Record<string, unknown> };
type GuardApi = {
	on(event: "tool_call", handler: (event: ToolCallEvent) => unknown): void;
};

const GUARD = join(homedir(), ".pi/host/hooks/guard.sh");

const TRUSTED = new Set([
	"bg_wait",
	"ask_user_question",
	"pi_lens_activate_tools",
	"ast_grep_dump",
	"fleet_watch",
	"fleet_unwatch",
]);

const READ_TOOLS = new Set([
	"lens_diagnostics",
	"lsp_diagnostics",
	"symbol_search",
	"module_report",
	"read_symbol",
	"read_enclosing",
	"ast_grep_search",
	"ast_grep_outline",
]);

const LSP_MUTATIONS = new Set(["rename", "rename_file", "executeCommand"]);

function strings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(strings);
	if (value && typeof value === "object")
		return Object.values(value).flatMap(strings);
	return [];
}

function pathStrings(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(pathStrings);
	if (!value || typeof value !== "object") return [];

	return Object.entries(value).flatMap(([key, nested]) =>
		key.toLowerCase().includes("path") ? strings(nested) : pathStrings(nested),
	);
}

function filePayload(
	toolName: "Read" | "Edit",
	input: Record<string, unknown>,
	fallback = "",
) {
	return {
		tool_name: toolName,
		tool_input: { file_path: pathStrings(input).join(" ") || fallback },
	};
}

function translate(toolName: string, input: Record<string, unknown>) {
	switch (toolName) {
		case "bash":
		case "powershell":
			return { tool_name: "Bash", tool_input: { command: input.command } };
		case "read":
		case "ls":
			return { tool_name: "Read", tool_input: { file_path: input.path } };
		case "edit":
			return { tool_name: "Edit", tool_input: { file_path: input.path } };
		case "write":
			return { tool_name: "Write", tool_input: { file_path: input.path } };
		case "grep":
			return {
				tool_name: "Grep",
				tool_input: { path: input.path, pattern: input.pattern },
			};
		case "find":
			return {
				tool_name: "Glob",
				tool_input: { path: input.path, pattern: input.pattern },
			};
		case "web_search":
		case "source_check":
			return {
				tool_name: "WebSearch",
				tool_input: { query: strings(input).join(" ") },
			};
		case "fetch_content":
		case "get_search_content":
			return {
				tool_name: "WebFetch",
				tool_input: { url: strings(input).join(" ") },
			};
		case "ast_grep_replace":
			return filePayload("Edit", input, ".");
		case "lsp_navigation":
			return filePayload(
				LSP_MUTATIONS.has(String(input.operation)) ? "Edit" : "Read",
				input,
				".",
			);
		case "lens_diagnostic_mark":
			return filePayload(
				input.disposition === "suppress" ? "Edit" : "Read",
				input,
			);
		case "project_report":
			return filePayload("Read", input, ".");
		case "subagent":
		case "subagent_supervisor":
			return { tool_name: "mcp__agent", tool_input: input };
		default:
			break;
	}

	if (READ_TOOLS.has(toolName)) return filePayload("Read", input, ".");

	if (
		toolName === "mcp" ||
		toolName === "mcpScript" ||
		toolName.startsWith("mcp__")
	) {
		const guardedName = toolName.startsWith("mcp__")
			? toolName
			: `mcp__${toolName}`;
		return { tool_name: guardedName, tool_input: input };
	}

	return null;
}

function policyError(reason: string) {
	return { block: true, reason: `Guard policy error: ${reason}` };
}

export default function (pi: GuardApi) {
	pi.on("tool_call", (event) => {
		if (TRUSTED.has(event.toolName)) return;

		const payload = translate(event.toolName, event.input ?? {});
		if (!payload)
			return { block: true, reason: `Unknown tool policy: ${event.toolName}` };

		const result = spawnSync("bash", [GUARD], {
			input: JSON.stringify(payload),
			encoding: "utf8",
		});
		if (result.error) return policyError(result.error.message);
		if (result.status !== 0)
			return policyError(`guard exited with status ${result.status}`);
		if (!result.stdout.trim()) return policyError("guard returned no decision");

		let output;
		try {
			output = JSON.parse(result.stdout);
		} catch {
			return policyError("guard returned invalid JSON");
		}

		const decision = output?.hookSpecificOutput;
		if (decision?.permissionDecision === "allow") return;
		if (decision?.permissionDecision !== "deny")
			return policyError("guard returned an invalid decision");

		return {
			block: true,
			reason: decision.permissionDecisionReason || "Guard denied the tool call",
		};
	});
}
