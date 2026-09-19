import assert from "node:assert/strict";
import { test } from "node:test";
import { renderSettings, withActiveProvider, type Models } from "./provider.ts";

const models: Models = {
	activeProvider: "openrouter",
	providers: {
		openrouter: {
			coordinator: { model: "glm", thinking: "high" },
			worker: { model: "glm-w", thinking: "high" },
			scout: { model: "glm-s", thinking: "low" },
		},
		"openai-codex": {
			coordinator: { model: "gpt-c", thinking: "max" },
			worker: { model: "gpt-w", thinking: "max" },
			scout: { model: "gpt-s", thinking: "low" },
		},
	},
};

test("renders provider and role tokens", () => {
	const out = renderSettings('{"p":"{{provider}}","m":"{{provider}}/{{models.worker}}"}', models);
	assert.equal(out, '{"p":"openrouter","m":"openrouter/glm-w"}');
});

test("renders the thinking level of a role", () => {
	assert.equal(renderSettings('{"t":"{{thinking.scout}}"}', models), '{"t":"low"}');
});

test("missing role fails", () => {
	assert.throws(() => renderSettings('{"m":"{{models.reviewer}}"}', models), /no openrouter entry for role reviewer/);
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
