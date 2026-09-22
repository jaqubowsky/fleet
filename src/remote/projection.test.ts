import assert from "node:assert/strict";
import test from "node:test";
import { transcript } from "./projection.ts";

const assistant = (content: unknown[]) => ({
	type: "message",
	message: { role: "assistant", content },
});
const result = (fields: Record<string, unknown>) => ({
	type: "message",
	message: { role: "toolResult", ...fields },
});

test("a tool call and its result read as one block inside the turn", () => {
	const entries = [
		assistant([
			{ type: "text", text: "Checking the tree." },
			{
				type: "toolCall",
				id: "c1",
				name: "bash",
				arguments: { command: "git status" },
			},
		]),
		result({
			toolCallId: "c1",
			toolName: "bash",
			content: [{ type: "text", text: "clean" }],
			isError: false,
		}),
	];

	const messages = transcript(entries);

	assert.deepEqual(messages, [
		{
			role: "assistant",
			blocks: [
				{ kind: "text", text: "Checking the tree." },
				{
					kind: "tool",
					id: "c1",
					name: "bash",
					summary: "git status",
					state: "done",
					result: "clean",
				},
			],
		},
	]);
});

test("each tool says what it is doing in one line", () => {
	const calls = [
		["bash", { command: "npm test" }],
		["read", { path: "src/a.ts", offset: 10 }],
		["edit", { path: "src/a.ts", edits: [] }],
		["grep", { pattern: "TODO", path: "src" }],
		["find", { pattern: "*.ts" }],
		["ls", {}],
		["web_search", { query: "pi extensions" }],
		["fetch_content", { url: "https://pi.dev" }],
		["subagent", { agent: "explorer", task: "trace the binding" }],
		["mystery_tool", { alpha: 1, beta: 2 }],
	] as const;

	const summaries = transcript([
		assistant(
			calls.map(([name, args], index) => ({
				type: "toolCall",
				id: `c${index}`,
				name,
				arguments: args,
			})),
		),
	])[0].blocks.map((block) => (block.kind === "tool" ? block.summary : ""));

	assert.deepEqual(summaries, [
		"npm test",
		"src/a.ts",
		"src/a.ts",
		"TODO in src",
		"*.ts",
		".",
		"pi extensions",
		"https://pi.dev",
		"explorer: trace the binding",
		"mystery_tool(alpha, beta)",
	]);
});

test("a secret in a tool argument never reaches the phone", () => {
	const messages = transcript([
		assistant([
			{
				type: "toolCall",
				id: "c1",
				name: "bash",
				arguments: {
					command: "curl -H 'x: sk-ant-abcdefgh12345678' https://x.dev",
				},
			},
		]),
		result({
			toolCallId: "c1",
			toolName: "bash",
			content: [{ type: "text", text: "token ghp_abcdefghijklmnopqrst used" }],
			isError: false,
		}),
	]);

	const [block] = messages[0].blocks;

	assert.equal(block.kind, "tool");
	assert.equal(block.summary, "curl -H 'x: [redacted]' https://x.dev");
	assert.equal(block.result, "token [redacted] used");
});

test("thinking and usage never become blocks", () => {
	const messages = transcript([
		assistant([
			{ type: "thinking", thinking: "private reasoning" },
			{ type: "text", text: "done" },
			{ type: "image", data: "AAAA", mimeType: "image/png" },
		]),
	]);

	assert.deepEqual(messages, [
		{ role: "assistant", blocks: [{ kind: "text", text: "done" }] },
	]);
});

test("an edit shows pi's own patch, and its arguments until one arrives", () => {
	const call = assistant([
		{
			type: "toolCall",
			id: "c1",
			name: "edit",
			arguments: {
				path: "src/a.ts",
				edits: [{ oldText: "const a = 1;", newText: "const a = 2;" }],
			},
		},
	]);

	const [before] = transcript([call])[0].blocks;
	const [after] = transcript([
		call,
		result({
			toolCallId: "c1",
			toolName: "edit",
			content: [{ type: "text", text: "1 edit applied" }],
			details: { patch: "@@ -1 +1 @@\n-const a = 1;\n+const a = 2;" },
			isError: false,
		}),
	])[0].blocks;

	assert.equal(before.kind === "tool" && before.diff, "-const a = 1;\n+const a = 2;");
	assert.equal(
		after.kind === "tool" && after.diff,
		"@@ -1 +1 @@\n-const a = 1;\n+const a = 2;",
	);
});

test("a failing tool is marked as failed", () => {
	const [block] = transcript([
		assistant([
			{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "x" } },
		]),
		result({
			toolCallId: "c1",
			toolName: "bash",
			content: [{ type: "text", text: "command not found" }],
			isError: true,
		}),
	])[0].blocks;

	assert.equal(block.kind === "tool" && block.state, "error");
});

test("a worst-case session still fits the snapshot budget", () => {
	const filler = "x".repeat(200_000);
	const entries = Array.from({ length: 400 }, (_, index) => [
		assistant([
			{ type: "text", text: filler },
			...Array.from({ length: 40 }, (_, slot) => ({
				type: "toolCall",
				id: `c${index}-${slot}`,
				name: "edit",
				arguments: {
					path: filler,
					edits: [{ oldText: filler, newText: filler }],
				},
			})),
		]),
		...Array.from({ length: 40 }, (_, slot) =>
			result({
				toolCallId: `c${index}-${slot}`,
				toolName: "edit",
				content: [{ type: "text", text: filler }],
				details: { patch: filler },
				isError: false,
			}),
		),
	]).flat();

	const messages = transcript(entries);
	const size = JSON.stringify(messages).length;

	assert.ok(messages.length <= 64, `at most 64 messages, got ${messages.length}`);
	for (const message of messages)
		assert.ok(
			message.blocks.length <= 32,
			`at most 32 blocks, got ${message.blocks.length}`,
		);
	assert.ok(size <= 524_288, `snapshot stays inside 512 KiB, got ${size}`);
});

test("a cut result says how much was cut", () => {
	const [block] = transcript([
		assistant([
			{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "x" } },
		]),
		result({
			toolCallId: "c1",
			toolName: "bash",
			content: [{ type: "text", text: "a".repeat(10_000) }],
			isError: false,
		}),
	])[0].blocks;

	assert.equal(block.kind, "tool");
	assert.match(block.result, /\n… \d+ characters omitted …\n/);
	assert.ok(block.result.length <= 4096, `result stays inside 4096`);
	assert.ok(block.result.startsWith("aaa") && block.result.endsWith("aaa"));
});

test("a message carries the time it happened", () => {
	const at = Date.UTC(2026, 8, 22, 19, 4, 5);

	const [dated] = transcript([
		{ type: "message", message: { role: "user", content: "hi", timestamp: at } },
	]);
	const [undated] = transcript([
		{ type: "message", message: { role: "user", content: "hi" } },
	]);

	assert.equal(dated.at, at);
	assert.equal("at" in undated, false);
});
