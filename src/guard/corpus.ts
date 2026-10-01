import { readFileSync } from "node:fs";
import { join } from "node:path";

type Case = { want: "allow" | "deny"; tool: string; subject: string };

const CORPUS = join(import.meta.dirname, "../../host/tests");

export function cases(file: string): Case[] {
	return readFileSync(join(CORPUS, file), "utf8")
		.split("\n")
		.filter((line) => line.trim() && !line.startsWith("#"))
		.map((line) => {
			const [want, tool, ...rest] = line.split("\t");

			return { want: want === "pass" ? "allow" : (want as "allow" | "deny"), tool, subject: rest.join("\t") };
		});
}

export function input(tool: string, subject: string): Record<string, unknown> {
	if (tool === "Bash") return { command: subject };
	if (tool === "Grep" || tool === "Glob") return { path: subject };
	if (tool === "WebFetch") return { url: subject, prompt: "summarise" };
	if (tool === "WebSearch") return { query: subject };
	if (tool.startsWith("mcp__")) return { title: subject };

	return { file_path: subject };
}
