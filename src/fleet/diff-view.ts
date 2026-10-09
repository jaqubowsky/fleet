import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { diffStatePath, type DiffPosition, type DiffSnapshot } from "./diff.ts";
import type { Io } from "./io.ts";

type DiffDocument = { lines: string[]; files: { path: string; line: number }[] };

export function plainDiff(text: string): string {
	return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").replaceAll("\t", "    ");
}

function wrap(text: string, width: number): string[] {
	const lines: string[] = [];
	let row = "";
	let style = "";
	let cells = 0;
	for (const token of text.match(/\x1b\[[0-9;]*m|[^]/gu) ?? []) {
		if (token.startsWith("\x1b[")) {
			style = token === "\x1b[0m" ? "" : style + token;
			row += token;
		} else {
			if (cells >= Math.max(1, width)) {
				lines.push(`${row}\x1b[0m`);
				row = style;
				cells = 0;
			}
			row += token;
			cells++;
		}
	}
	lines.push(`${row}\x1b[0m`);
	return lines;
}

export function diffDocument(snapshot: DiffSnapshot, rendered: string, width: number): DiffDocument {
	const raw = rendered.trimEnd().split("\n");
	const document: DiffDocument = { lines: [], files: [] };
	for (const [index, file] of snapshot.files.entries()) {
		if (index) document.lines.push("");
		document.files.push({ path: file.path, line: document.lines.length });
		document.lines.push(`\x1b[35m${"─".repeat(Math.max(1, width))}\x1b[0m`);
		document.lines.push(...wrap(`\x1b[1;35m${index + 1}/${snapshot.files.length}  ${file.status}  ${plainDiff(file.path)}\x1b[0m`, width));
		let metadata = true;
		for (const line of raw.slice(file.line, snapshot.files[index + 1]?.line)) {
			const text = stripVTControlCharacters(line);
			if (text.startsWith("@@")) metadata = false;
			if (metadata && /^(diff --git |index |--- |\+\+\+ )/.test(text)) continue;
			document.lines.push(...wrap(line, width));
		}
	}
	return document;
}

export function diffOffset(document: DiffDocument, position: DiffPosition): number {
	return (document.files.find(file => file.path === position.path)?.line ?? 0) + position.offset;
}

export function scrollDiff(document: DiffDocument, position: DiffPosition, delta: number): DiffPosition {
	const offset = Math.max(0, Math.min(Math.max(0, document.lines.length - 1), diffOffset(document, position) + delta));
	const file = document.files.slice().reverse().find(file => file.line <= offset);
	return { ...position, path: file?.path ?? "", offset: offset - (file?.line ?? 0) };
}

function visibleFiles(snapshot: DiffSnapshot | undefined, position: DiffPosition, height: number) {
	const files = snapshot?.files ?? [];
	const selected = Math.max(0, files.findIndex(f => f.path === position.path));
	const count = Math.min(6, files.length, Math.max(0, height - 10));
	const first = Math.max(0, selected - count + 1);
	return files.slice(first, first + count);
}

export function clickedDiffFile(snapshot: DiffSnapshot | undefined, position: DiffPosition, row: number, height: number): string | undefined {
	return visibleFiles(snapshot, position, height)[row - 4]?.path;
}

export function diffInput(text: string): { keys: string; pending: string; clicks: { button: number; column: number; row: number }[] } {
	const clicks: { button: number; column: number; row: number }[] = [];
	let keys = text.replace(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g, (_, button, column, row, action) => {
		if (action === "M") clicks.push({ button: Number(button), column: Number(column), row: Number(row) });
		return "";
	});
	const partial = keys.match(/\x1b(?:\[(?:<[\d;]*)?)?$/);
	const pending = partial?.[0] ?? "";
	if (pending) keys = keys.slice(0, -pending.length);
	return { keys, pending, clicks };
}

export function diffScreen(snapshot: DiffSnapshot | undefined, position: DiffPosition, lines: string[], message: string, paused: boolean, width: number, height: number): string {
	const files = snapshot?.files ?? [];
	const rows = [
		`\x1b[1;35mChanges  ${paused ? "PAUSED" : snapshot?.status ?? "Loading"}`,
		`${position.scope === "uncommitted" ? "Uncommitted" : `Branch vs ${plainDiff(snapshot?.base ?? "base")}`}  ${plainDiff(position.repository.split("/").at(-1) ?? "")}`,
		`${files.length} files  Click or [ / ] to jump  Tab repository`,
		...visibleFiles(snapshot, position, height).map(f => `${f.path === position.path ? "\x1b[35m>" : " "} ${f.status} ${plainDiff(f.path)}`),
	];
	if (!files.length) rows.push(snapshot?.status === "Live" ? "No changes in this range" : "Waiting for changes");
	const bodyHeight = Math.max(0, height - rows.length - 2);
	rows.push(...lines.slice(position.offset, position.offset + bodyHeight));
	while (rows.length < height - 2) rows.push("");
	rows.push(`${plainDiff(message)}  ${Math.min(position.offset + 1, lines.length)}/${lines.length}`, "Scroll all files  s scope  p pause  r refresh  q close");
	return rows.slice(0, height).map(row => wrap(row, width)[0]).join("\r\n");
}

export async function diffView(name: string, root: string, io: Io): Promise<void> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("The live diff needs a terminal");
	const statePath = diffStatePath(name, io);
	const position: DiffPosition = { repository: "", scope: "task", path: "", offset: 0, ...JSON.parse(io.read(statePath) ?? "{}") };
	let snapshot: DiffSnapshot | undefined;
	let document: DiffDocument = { lines: [], files: [] };
	let rendered = "";
	let message = "Reading container changes";
	let paused = false;
	let closed = false;
	let generation = 0;
	let timer: NodeJS.Timeout | undefined;
	let child: ChildProcess | undefined;
	let previousPatch: string | undefined;
	const out = process.stdout;
	const save = () => { io.mkdir(dirname(statePath)); io.write(statePath, JSON.stringify(position)); };
	const draw = () => {
		if (!closed) out.write(`\x1b[H\x1b[2J${diffScreen(snapshot, { ...position, offset: diffOffset(document, position) }, document.lines, message, paused, out.columns, out.rows)}`);
	};
	const cancel = () => {
		generation++;
		clearTimeout(timer);
		if (child?.pid) {
			try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
		}
	};
	const run = (command: string, args: string[], input?: string) => new Promise<string>((accept, reject) => {
		const running = spawn(command, args, { detached: true, stdio: "pipe" });
		let stdout = "";
		let stderr = "";
		const deadline = setTimeout(() => {
			if (running.pid) process.kill(-running.pid, "SIGTERM");
		}, 20_000);
		running.stdout.setEncoding("utf8").on("data", (text: string) => { stdout += text; });
		running.stderr.setEncoding("utf8").on("data", (text: string) => { stderr += text; });
		running.on("error", reject);
		running.on("close", (code, signal) => {
			clearTimeout(deadline);
			if (child === running) child = undefined;
			if (code !== 0) reject(new Error(stderr.trim() || `${command} exited: ${signal ?? code}`));
			else accept(stdout);
		});
		child = running;
		running.stdin.end(input);
	});
	const rebuild = () => {
		if (snapshot) document = diffDocument(snapshot, rendered, out.columns);
		if (!document.files.some(file => file.path === position.path)) { position.path = document.files[0]?.path ?? ""; position.offset = 0; }
		Object.assign(position, scrollDiff(document, position, 0));
	};
	const refresh = async () => {
		cancel();
		const request = generation;
		try {
			const next: DiffSnapshot = JSON.parse(await run(process.execPath, [resolve(root, "src/fleet/cli.ts"), "diff", name, "--snapshot", "--scope", position.scope, "--repo", position.repository]));
			if (closed || generation !== request) return;
			if (next.status !== "Live") {
				if (snapshot) snapshot.status = next.status;
				else snapshot = next;
				message = `${next.status}. Last snapshot retained.`;
			} else {
				const patch = plainDiff(next.patch);
				if (patch !== previousPatch) {
					const colored = patch ? await run("delta", ["--paging=never", "--color-only", "--true-color=always"], patch) : "";
					if (closed || generation !== request) return;
					rendered = colored;
					previousPatch = patch;
				}
				position.repository = next.repository;
				snapshot = next;
				rebuild();
				message = `Updated ${new Date().toLocaleTimeString()}`;
				save();
			}
		} catch (error) {
			if (closed || generation !== request) return;
			message = `Read failed: ${(error as Error).message}`;
		}
		if (closed || generation !== request) return;
		draw();
		if (!paused) timer = setTimeout(refresh, 2000);
	};
	const leave = () => {
		if (closed) return;
		closed = true;
		cancel();
		save();
		process.stdin.setRawMode(false);
		out.write("\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l");
		process.exit(0);
	};
	const closePanel = () => {
		if (io.pane !== "-") io.herdr(["pane", "close", io.pane]);
		leave();
	};
	const jump = (path: string) => { position.path = path; position.offset = 0; };
	const scroll = (delta: number) => Object.assign(position, scrollDiff(document, position, delta));
	out.write("\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h");
	const keyboard = new PassThrough();
	emitKeypressEvents(keyboard);
	process.stdin.setRawMode(true);
	let pending = "";
	process.stdin.on("data", (data: Buffer) => {
		const input = diffInput(pending + data.toString("utf8"));
		pending = input.pending;
		for (const click of input.clicks) {
			if (click.button === 64 || click.button === 65) scroll(click.button === 64 ? -3 : 3);
			else if (click.button === 0) {
				const path = clickedDiffFile(snapshot, position, click.row, out.rows);
				if (path !== undefined) jump(path);
			}
		}
		if (input.clicks.length) { save(); draw(); }
		if (input.keys) keyboard.write(input.keys);
	});
	keyboard.on("keypress", (text: string, key: { name: string; ctrl: boolean }) => {
		if (text === "q" || key.ctrl && key.name === "c") { closePanel(); return; }
		if (text === "p") { paused = !paused; cancel(); if (!paused) void refresh(); }
		else if (text === "r") void refresh();
		else if (text === "s" || key.name === "tab") {
			if (text === "s") position.scope = position.scope === "task" ? "uncommitted" : "task";
			else if (snapshot?.repositories.length) {
				const repos = snapshot.repositories;
				position.repository = repos[(repos.indexOf(position.repository) + 1) % repos.length];
			}
			position.path = "";
			position.offset = 0;
			void refresh();
		} else if ((text === "[" || text === "]") && document.files.length) {
			const files = document.files;
			const index = files.findIndex(f => f.path === position.path);
			jump(files[Math.max(0, Math.min(files.length - 1, index + (text === "[" ? -1 : 1)))].path);
		} else {
			const page = Math.max(1, out.rows - 11);
			const step = key.name === "pagedown" || text === " " ? page : key.name === "pageup" ? -page : text === "j" || key.name === "down" ? 1 : text === "k" || key.name === "up" ? -1 : key.name === "home" ? -document.lines.length : key.name === "end" ? document.lines.length : 0;
			scroll(step);
		}
		save();
		draw();
	});
	out.on("resize", () => { rebuild(); draw(); });
	process.on("SIGTERM", leave);
	process.on("SIGHUP", leave);
	process.on("SIGINT", leave);
	draw();
	await refresh();
	await new Promise(() => {});
}
