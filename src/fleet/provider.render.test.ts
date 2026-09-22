import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeIo } from "./fake-io.ts";
import { render } from "./provider.ts";

test("render writes both settings and both AGENTS.md", () => {
	const io = fakeIo({
		"read /root/profiles/models.json": JSON.stringify({ seats: { host: { model: "openai-codex/m1", thinking: "high" }, sbx: { model: "openrouter/z-ai/w1", thinking: "max" } } }),
		"read /root/profiles/host.json": '{"m":"{{providers.host}}/{{models.host}}"}',
		"read /root/profiles/sbx.json": '{"p":"{{providers.sbx}}","m":"{{models.sbx}}"}',
		"list /root/rules": ["host.md", "core.md", "delegation.md"],
		"read /root/rules/core.md": "# Core",
		"read /root/rules/delegation.md": "# Delegation",
		"read /root/rules/host.md": "# Host",
		"read /root/sbx/container/sandbox.md": "# Container",
	});

	render("/root", io);

	assert.equal(io.files["/root/agent/settings.json"], '{"m":"openai-codex/m1"}');
	assert.equal(io.files["/root/sbx/agent-settings.json"], '{"p":"openrouter","m":"z-ai/w1"}');
	assert.equal(io.files["/root/agent/AGENTS.md"], "# Core\n\n# Delegation\n\n# Host\n");
	assert.equal(io.files["/root/sbx/AGENTS.md"], "# Core\n\n# Delegation\n\n# Container\n");
});

test("render copies the disclosed refs next to AGENTS.md and keeps them out of it", () => {
	const io = fakeIo({
		"read /root/profiles/models.json": JSON.stringify({ seats: { host: { model: "openai-codex/m1", thinking: "high" }, sbx: { model: "openai-codex/w1", thinking: "high" } } }),
		"read /root/profiles/host.json": '{"m":"{{models.host}}"}',
		"read /root/profiles/sbx.json": '{"m":"{{models.sbx}}"}',
		"list /root/rules/refs": ["testing.md", "architecture.md"],
		"list /root/rules": ["core.md"],
		"read /root/rules/refs/testing.md": "# Testing",
		"read /root/rules/refs/architecture.md": "# Architecture",
		"read /root/rules/core.md": "# Core",
		"read /root/sbx/container/sandbox.md": "# Container",
	});

	render("/root", io);

	assert.equal(io.files["/root/agent/refs/testing.md"], "# Testing");
	assert.equal(io.files["/root/agent/refs/architecture.md"], "# Architecture");
	assert.equal(io.files["/root/agent/AGENTS.md"], "# Core\n");
	assert.equal(io.files["/root/sbx/AGENTS.md"], "# Core\n\n# Container\n");
});
