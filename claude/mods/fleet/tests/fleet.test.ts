import type { On } from "claude-code";
import { expect, test } from "claude-code/testing";

const SESSION = { cwd: "/w", surface: "terminal", isInteractive: true } as const;
const TYPED = { origin: { kind: "composer" }, presentation: { isFullscreen: false, columns: 120 } } as const;

const wake = (agent: string, change: string) =>
	`${JSON.stringify({ wake: `[fleet] ${agent}: ${change}\n\nstatus: done` })}\n`;

function engine(on: On, lines: string[]) {
	const spawned: string[][] = [];
	const submitted: string[] = [];
	on("session.start", ($, e) => ({ cwd: e.cwd }));
	on("tool.register", ($, e) => ({ value: { tool: `mcp__fleet__${e.name}` } }));
	on("command.register", ($, e) => ({ value: { command: e.name } }));
	on("process.spawn", async function* ($, e) {
		spawned.push([...e.argv]);
		for (const text of lines) yield { stream: "stdout" as const, text };
		return { value: { code: 0, signal: null } };
	});
	on("turn.start", ($, e) => ({ turnId: e.turnId }));
	on("turn.complete", ($, e) => ({ text: e.answer, reason: "answer" }));
	on("prompt.submit", ($, e) => {
		submitted.push(e.text);
		return { text: e.text };
	});
	return { spawned, submitted };
}

test("a wake while the session is idle starts a turn with the wake", async ($, on) => {
	const { submitted } = engine(on, [wake("claude-a", "working -> done")]);

	await $.session.start(SESSION);

	expect(submitted).toEqual(["[fleet] claude-a: working -> done\n\nstatus: done"]);
});

test("a wake split across two pieces of output still arrives whole", async ($, on) => {
	const line = wake("claude-a", "working -> done");
	const { submitted } = engine(on, [line.slice(0, 10), line.slice(10)]);

	await $.session.start(SESSION);

	expect(submitted).toEqual(["[fleet] claude-a: working -> done\n\nstatus: done"]);
});

test("wakes during a turn arrive together once the turn ends, not when a subagent's does", async ($, on) => {
	const { submitted } = engine(on, [wake("claude-a", "working -> done"), wake("pi-b", "working -> blocked")]);
	const ended = { answer: "", durationMs: 1, isAborted: false, turnId: "t1", reason: "answer" } as const;
	await $.turn.start({ text: "go", turnId: "t1" });
	await $.session.start(SESSION);

	await $.turn.complete({ ...ended, agentId: "sub" });
	const during = [...submitted];
	await $.turn.complete(ended);

	expect(during).toEqual([]);
	expect(submitted).toEqual([
		"[fleet] claude-a: working -> done\n\nstatus: done\n\n[fleet] pi-b: working -> blocked\n\nstatus: done",
	]);
});

test("the watched containers draw on a row under the session mode, each status in its colour", async ($, on) => {
	engine(on, [`${JSON.stringify({ watching: "claude-a working · pi-b idle" })}\n`]);
	on("ui.render", { component: "SessionMode" }, () => ({ type: "Text", props: {}, children: ["auto mode on"] }));
	await $.session.start(SESSION);

	const ui = await $.ui.mount({ plugin: "fleet", surface: "terminal", component: "SessionMode", props: { modes: ["auto mode on"] } });

	const texts = (await ui.findAll({ type: "Text" })).map((t) => t.text);
	expect(texts[0]).toBe("auto mode on");
	expect(texts).toContain("◉ watching  claude-a working · pi-b idle");
	expect((await ui.find({ type: "Text", text: /^working$/ }))?.props.color).toBe("yellow");
	expect((await ui.find({ type: "Text", text: /^idle$/ }))?.props.color).toBe("green");
	expect((await ui.find({ type: "Text", text: /^watching/ }))?.props.color).toBe("magenta");
});

test("with nothing watched the session mode draws as the engine has it", async ($, on) => {
	engine(on, [`${JSON.stringify({ watching: "" })}\n`]);
	on("ui.render", { component: "SessionMode" }, () => ({ type: "Text", props: {}, children: ["auto mode on"] }));
	await $.session.start(SESSION);

	const ui = await $.ui.mount({ plugin: "fleet", surface: "terminal", component: "SessionMode", props: { modes: ["auto mode on"] } });

	expect(await ui.drawn()).toEqual({ type: "Text", props: {}, children: ["auto mode on"] });
});

test("watching with no names follows every container", async ($, on) => {
	const { spawned } = engine(on, []);
	await $.session.start(SESSION);

	await $.command.run({ command: "fleet-watch", args: "", ...TYPED });

	expect(spawned).toEqual([
		["fleet", "watch", "--json"],
		["fleet", "watch", "--json", "--every"],
	]);
});

test("watching named containers follows those names", async ($, on) => {
	const { spawned } = engine(on, []);
	await $.session.start(SESSION);

	await $.command.run({ command: "fleet-watch", args: "claude-a, pi-b", ...TYPED });

	expect(spawned.at(-1)).toEqual(["fleet", "watch", "--json", "claude-a", "pi-b"]);
});

test("the model's watch tool follows the names it passes", async ($, on) => {
	const { spawned } = engine(on, []);
	await $.session.start(SESSION);

	const called = await $.tool.call({ tool: "mcp__fleet__watch", agents: "claude-a" });

	expect(called.text).toBe("fleet: watching claude-a");
	expect(spawned.at(-1)).toEqual(["fleet", "watch", "--json", "claude-a"]);
});
