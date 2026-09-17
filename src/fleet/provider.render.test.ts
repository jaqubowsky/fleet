import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeIo } from "./fake-io.ts";
import { render } from "./provider.ts";

test("render switches the provider, writes both settings and both AGENTS.md", () => {
	const io = fakeIo({
		"read /root/profiles/models.json": JSON.stringify({ activeProvider: "a", providers: { a: { coordinator: "m1", worker: "w1" }, b: { coordinator: "m2", worker: "w2" } } }),
		"read /root/profiles/host.json": '{"m":"{{provider}}/{{models.coordinator}}"}',
		"read /root/profiles/sbx.json": '{"m":"{{models.worker}}"}',
		"list /root/rules": ["env.md", "core.md", "delegation.md"],
		"read /root/rules/core.md": "# Core",
		"read /root/rules/delegation.md": "# Delegation",
		"read /root/rules/env.md": "# Env",
		"read /root/sbx/container/sandbox.md": "# Container",
	});
	render("/root", io, "b");
	assert.equal(io.files["/root/agent/settings.json"], '{"m":"b/m2"}');
	assert.equal(io.files["/root/sbx/agent-settings.json"], '{"m":"w2"}');
	assert.equal(JSON.parse(io.files["/root/profiles/models.json"]).activeProvider, "b");
	assert.equal(io.files["/root/agent/AGENTS.md"], "# Core\n\n# Delegation\n\n# Env\n");
	assert.equal(io.files["/root/sbx/AGENTS.md"], "# Core\n\n# Container\n");
});

test("render copies the disclosed refs next to AGENTS.md and keeps them out of it", () => {
	const io = fakeIo({
		"read /root/profiles/models.json": JSON.stringify({ activeProvider: "a", providers: { a: { coordinator: "m1", worker: "w1" } } }),
		"read /root/profiles/host.json": '{"m":"{{models.coordinator}}"}',
		"read /root/profiles/sbx.json": '{"m":"{{models.worker}}"}',
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
