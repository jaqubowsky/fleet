import assert from "node:assert/strict";
import { test } from "node:test";
import statusline from "../../extensions/statusline.ts";

type Footer = (tui: unknown, theme: unknown, data: { getExtensionStatuses(): Map<string, string> }) => { render(width: number): string[] };

test("pi's footer ends with the marker pi-remote sets", () => {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
	let footer: Footer | undefined;
	statusline({ on: (name: string, fn: (event: unknown, ctx: unknown) => void) => handlers.set(name, fn) });
	handlers.get("session_start")!({}, { hasUI: true, cwd: "/tmp", ui: { setFooter: (factory: Footer) => { footer = factory; } } });

	const lines = footer!(undefined, undefined, { getExtensionStatuses: () => new Map([["pi-remote", "⌁ remote"]]) }).render(200);

	assert.equal(lines.length, 1);
	assert.match(lines[0], /\x1b\[90m⌁ remote\x1b\[0m$/);
});

test("pi's footer shows the containers the fleet monitor watches on a line under the status line", () => {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
	let footer: Footer | undefined;
	statusline({ on: (name: string, fn: (event: unknown, ctx: unknown) => void) => handlers.set(name, fn) });
	handlers.get("session_start")!({}, { hasUI: true, cwd: "/tmp", ui: { setFooter: (factory: Footer) => { footer = factory; } } });

	const lines = footer!(undefined, undefined, { getExtensionStatuses: () => new Map([["fleet", "pi-a working"]]) }).render(200);

	assert.equal(lines.length, 2);
	assert.doesNotMatch(lines[0], /pi-a/);
	assert.equal(lines[1].replace(/\x1b\[[0-9;]*m/g, ""), " ◉ watching  pi-a working");
});
