import assert from "node:assert/strict";
import { test } from "node:test";
import statusline from "../../extensions/statusline.ts";

type Footer = (tui: unknown, theme: unknown, data: { getExtensionStatuses(): Map<string, string> }) => { render(width: number): string[] };

test("pi's footer ends with the marker pi-remote sets", () => {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
	let footer: Footer | undefined;
	statusline({ on: (name: string, fn: (event: unknown, ctx: unknown) => void) => handlers.set(name, fn) });
	handlers.get("session_start")!({}, { hasUI: true, cwd: "/tmp", ui: { setFooter: (factory: Footer) => { footer = factory; } } });

	const [, line] = footer!(undefined, undefined, { getExtensionStatuses: () => new Map([["pi-remote", "⌁ remote"]]) }).render(200);

	assert.match(line, /\x1b\[90m⌁ remote\x1b\[0m$/);
});
