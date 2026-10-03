const FLEET = ["fleet_watch", "fleet_unwatch"];

export const TRUSTED: Partial<Record<string, Set<string>>> = {
	pi: new Set(["bg_wait", "codemode", "ask_user_question", ...FLEET]),
};

const READ_TOOLS = new Set(["glob", "ast_grep"]);

const LSP_MUTATIONS = new Set(["rename", "rename_file", "move", "format", "code_action", "executeCommand"]);

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

function filePayload(toolName: "Read" | "Edit", input: Record<string, unknown>) {
	return {
		tool_name: toolName,
		tool_input: { file_path: pathStrings(input).join(" ") || "." },
	};
}

function shellCommand(input: Record<string, unknown>): string {
	const env = Object.entries((input.env ?? {}) as Record<string, string>).map(([key, value]) => `${key}=${JSON.stringify(value)} `).join("");
	const command = `${env}${String(input.command ?? "")}`;
	return typeof input.cwd === "string" ? `cd ${JSON.stringify(input.cwd)} && ${command}` : command;
}

export function translate(toolName: string, input: Record<string, unknown>) {
	switch (toolName) {
		case "bash":
		case "powershell":
			return { tool_name: "Bash", tool_input: { command: shellCommand(input) } };
		case "read":
		case "ls": {
			const path = String(input.path ?? "");
			return /^https?:\/\//.test(path)
				? { tool_name: "WebFetch", tool_input: { url: path } }
				: { tool_name: "Read", tool_input: { file_path: path } };
		}
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
		case "glob":
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
		case "ast_edit":
			return filePayload("Edit", input);
		case "lsp":
			return filePayload(LSP_MUTATIONS.has(String(input.operation)) ? "Edit" : "Read", input);
		case "eval":
			return { tool_name: "Bash", tool_input: { command: strings(input).join(" ") } };
		case "subagent":
		case "subagent_supervisor":
		case "task":
			return { tool_name: "mcp__agent", tool_input: input };
		case "browser":
		case "computer":
		case "github":
		case "security_scan":
		case "generate_image":
		case "tts":
			return { tool_name: `mcp__${toolName}`, tool_input: input };
		default:
			break;
	}

	if (READ_TOOLS.has(toolName)) return filePayload("Read", input);

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
