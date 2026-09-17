import assert from "node:assert/strict";
import { test } from "node:test";
import { renderSettings, withActiveProvider, type Models } from "./provider.ts";

const models: Models = {
	activeProvider: "openrouter",
	providers: {
		openrouter: { coordinator: "glm", worker: "glm-w", scout: "glm-s" },
		"openai-codex": { coordinator: "gpt-c", worker: "gpt-w", scout: "gpt-s" },
	},
};

test("renders provider and role tokens", () => {
	const out = renderSettings('{"p":"{{provider}}","m":"{{provider}}/{{models.worker}}"}', models);
	assert.equal(out, '{"p":"openrouter","m":"openrouter/glm-w"}');
});

test("missing role fails", () => {
	assert.throws(() => renderSettings('{"m":"{{models.reviewer}}"}', models), /no openrouter model for role reviewer/);
});

test("unknown token fails", () => {
	assert.throws(() => renderSettings('{"m":"{{nope}}"}', models), /unresolved token/);
});

test("switching keeps providers and validates the name", () => {
	assert.equal(withActiveProvider(models, "openai-codex").activeProvider, "openai-codex");
	assert.throws(() => withActiveProvider(models, "anthropic"), /unknown provider/);
});

test("a template that renders to invalid JSON is refused", () => {
	assert.throws(() => renderSettings('{"m": {{models.worker}}}', models), /JSON/);
});
