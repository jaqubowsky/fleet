import assert from "node:assert/strict";
import { test } from "node:test";
import { renderSettings, type Models } from "./provider.ts";

const models: Models = {
	seats: {
		host: { model: "openai-codex/gpt-c", thinking: "max" },
		sbx: { model: "openrouter/z-ai/glm-5.3-flash", thinking: "max" },
		scout: { model: "openai-codex/gpt-s", thinking: "low" },
	},
};

test("a seat renders its provider and its model apart", () => {
	assert.equal(renderSettings('{"p":"{{providers.host}}","m":"{{models.host}}"}', models), '{"p":"openai-codex","m":"gpt-c"}');
});

test("seats on different providers render side by side", () => {
	assert.equal(
		renderSettings('{"w":"{{providers.sbx}}/{{models.sbx}}","s":"{{providers.scout}}/{{models.scout}}"}', models),
		'{"w":"openrouter/z-ai/glm-5.3-flash","s":"openai-codex/gpt-s"}',
	);
});

test("renders the thinking level of a seat", () => {
	assert.equal(renderSettings('{"t":"{{thinking.scout}}"}', models), '{"t":"low"}');
});

test("missing seat fails", () => {
	assert.throws(() => renderSettings('{"m":"{{models.reviewer}}"}', models), /no entry for seat reviewer/);
});

test("a model that names no provider fails", () => {
	assert.throws(() => renderSettings('{"m":"{{models.host}}"}', { seats: { host: { model: "gpt-c", thinking: "max" } } }), /needs a provider\/model/);
});

test("unknown token fails", () => {
	assert.throws(() => renderSettings('{"m":"{{nope}}"}', models), /unresolved token/);
});

test("a template that renders to invalid JSON is refused", () => {
	assert.throws(() => renderSettings('{"m": {{models.sbx}}}', models), /JSON/);
});
