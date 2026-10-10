import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

type Line = { wake?: string; log?: string; watching?: string };

const WATCH_DESCRIPTION =
	"Watch containers beyond the ones this herdr pane put up or steered, which are watched by themselves. A watched container settling or working on without settling wakes this session with a [fleet] <agent>: <label> turn carrying the last 15 lines of its pane; the label says whether its closing message asks a question, ended the turn, or is missing. Pass the sandbox names fleet ls prints; an empty string watches every container.";

const AGENT_STATUS: Record<string, string> = { working: "yellow", idle: "green", done: "green", blocked: "red", exited: "red", gone: "red" };

const watching = atom({ plugin: "fleet", key: "watching" } as const, "");

const watcher = {
	stop: undefined as (() => void) | undefined,
	running: false,
	held: [] as string[],
	said: new Set<string>(),
};

function send($: EngineInterface, text: string) {
	$.ui.toast(text.split("\n", 1).join(""));
	void $.prompt.submit({ text });
}

function heard($: EngineInterface, line: Line) {
	const containers = line.watching;
	if (containers !== undefined) void update($, watching, () => containers);
	if (line.log !== undefined && !watcher.said.has(line.log)) {
		watcher.said.add(line.log);
		$.ui.toast(line.log);
	}
	if (line.wake === undefined) return;
	if (watcher.running) watcher.held.push(line.wake);
	else send($, line.wake);
}

function follow($: EngineInterface, args: string[]) {
	watcher.stop?.();
	watcher.said.clear();
	const child = $.process.spawn({ argv: ["fleet", "watch", "--json", ...args] });
	watcher.stop = () => void child.return(undefined as never);
	void (async () => {
		let buffer = "";
		for await (const { stream, text } of child) {
			if (stream === "stderr") {
				$.ui.log(text, { to: "debug" });
				continue;
			}
			buffer += text;
			for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
				heard($, JSON.parse(buffer.slice(0, nl)) as Line);
				buffer = buffer.slice(nl + 1);
			}
		}
	})();
}

function watch($: EngineInterface, text: string) {
	const names = text.trim().split(/[\s,]+/).filter(Boolean);
	follow($, names.length ? names : ["--every"]);
	return names.length ? `fleet: watching ${names.join(", ")}` : "fleet: watching every container";
}

function unwatch($: EngineInterface) {
	follow($, []);
	return "fleet: stopped";
}

export const register: Register = (on) => {
	on("session.start", async ($, e, next) => {
		const started = await next(e);
		follow($, []);
		await $.tool.register({
			name: "watch",
			description: WATCH_DESCRIPTION,
			inputSchema: {
				type: "object",
				properties: {
					agents: {
						type: "string",
						description:
							"Space- or comma-separated sandbox names as fleet ls prints them. Empty string watches every container",
					},
				},
				required: ["agents"],
			},
		});
		await $.tool.register({
			name: "unwatch",
			description: "Stop the watch started by mcp__fleet__watch; the containers this pane put up or steered stay watched.",
		});
		await $.command.register({
			name: "fleet-watch",
			description: "Watch containers beyond the ones this pane put up or steered; no names watches every container",
			argumentHint: "[sandbox...]",
		});
		await $.command.register({
			name: "fleet-unwatch",
			description: "Stop the watch started by /fleet-watch",
		});
		return started;
	});

	on("tool.call", { tool: "mcp__fleet__watch" }, ($, e) => {
		const text = watch($, String((e as { agents?: unknown }).agents ?? ""));
		return { result: text, text };
	});
	on("tool.call", { tool: "mcp__fleet__unwatch" }, ($) => {
		const text = unwatch($);
		return { result: text, text };
	});
	on("command.run", { command: "fleet-watch" }, ($, e) => ({ text: watch($, e.args) }));
	on("command.run", { command: "fleet-unwatch" }, ($) => ({ text: unwatch($) }));

	on("ui.render", { component: "SessionMode" }, async ($, e, next) => {
		const drawn = await next(e);
		const containers = await read($, watching);
		if (!containers) return drawn;
		const { Box, Text } = $.ui.resolve(e);
		return (
			<Box flexDirection="column">
				{drawn}
				<Text>
					<Text color="yellow">◉ </Text>
					<Text color="magenta">watching  </Text>
					{containers.split(" · ").map((entry, i) => {
						const cut = entry.lastIndexOf(" ");
						const state = entry.slice(cut + 1);
						return (
							<Text key={entry}>
								{i ? <Text dimColor> · </Text> : ""}
								{`${entry.slice(0, cut)} `}
								<Text color={AGENT_STATUS[state] ?? "magenta"}>{state}</Text>
							</Text>
						);
					})}
				</Text>
			</Box>
		);
	});

	on("turn.start", async ($, e, next) => {
		watcher.running = true;
		return next(e);
	});
	on("turn.complete", async ($, e, next) => {
		const result = await next(e);
		if (e.agentId) return result;
		watcher.running = false;
		if (watcher.held.length) send($, watcher.held.splice(0).join("\n\n"));
		return result;
	});
};
