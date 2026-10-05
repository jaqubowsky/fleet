import { fieldsOf } from "../../extensions/status-history.ts";
import { CLI } from "../harness.ts";
import { stopFile } from "./commands.ts";
import type { Io } from "./io.ts";
import { taskDir } from "./repositories.ts";
import type { Sandbox } from "./status.ts";

export type StoppedView = { name: string; since?: Date; status?: string; attention?: string };

type Rgb = readonly [number, number, number];
type Cell = { ch: string; fg?: Rgb; bold?: boolean };

const AYU = {
	fg: [204, 202, 194],
	ui: [112, 122, 140],
	accent: [255, 204, 102],
	fleet: [223, 191, 255],
} as const satisfies Record<string, Rgb>;

const CARD_MAX = 72;
const LABEL = 11;
const clock = (at: Date) => `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
const clip = (text: string, room: number) => (text.length > room ? `${text.slice(0, Math.max(0, room - 1))}…` : text);

function wrap(text: string, room: number, lines: number): string[] {
	const out: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		if (line && line.length + 1 + word.length > room) {
			out.push(line);
			line = "";
		}
		line = line ? `${line} ${word}` : word;
	}
	if (line) out.push(line);
	if (out.length <= lines) return out.map((l) => clip(l, room));
	return [...out.slice(0, lines - 1).map((l) => clip(l, room)), clip(`${out[lines - 1]}…`, room)];
}

export function keepName(pane: string, name: string, io: Io): void {
	try {
		if (io.herdr<{ result?: { agent?: { name?: string } } }>(["agent", "get", pane]).result?.agent?.name === name) return;
		io.herdr(["agent", "rename", pane, name]);
	} catch {}
}

export function stoppedView(sandbox: Pick<Sandbox, "name" | "workspaces">, io: Io): StoppedView {
	const { status, attention } = fieldsOf(io.read(`${taskDir(sandbox.workspaces[0], sandbox.name, io)}/status.md`));
	return { name: sandbox.name, since: io.stat(stopFile(sandbox, io))?.mtime, status, attention };
}

function cardRows(view: StoppedView, inner: number): Cell[][] {
	const text = (s: string, fg?: Rgb, bold?: boolean): Cell[] => [...s].map((ch) => ({ ch, fg, bold }));
	const row = (...parts: Cell[][]): Cell[] => {
		const cells = parts.flat().slice(0, inner);
		return [...cells, ...text(" ".repeat(inner - cells.length))];
	};
	const field = (label: string, value: string) => row(text(label.padEnd(LABEL), AYU.ui), text(value, AYU.fg));
	const since = view.since ? `since ${clock(view.since)}` : "";
	const heading = "◉ stopped";
	const attention = view.attention && view.attention !== "none" ? wrap(view.attention, inner - LABEL, 2) : [];
	const command = `${CLI} start ${view.name}`;
	return [
		row(),
		row(text(heading, AYU.fleet, true), text(" ".repeat(Math.max(1, inner - heading.length - since.length))), text(since, AYU.ui)),
		row(),
		row(text(clip(view.name, inner), AYU.fg, true)),
		row(),
		...(view.status ? [field("status", view.status)] : []),
		...attention.map((line, i) => field(i ? "" : "attention", line)),
		row(),
		row(text("resume  ", AYU.ui), text(clip(command, inner - 8), AYU.accent, true)),
		row(),
	];
}

function paint(grid: Cell[][]): string[] {
	const sgr = (cell: Cell) => `\x1b[0m${cell.bold ? "\x1b[1m" : ""}${cell.fg ? `\x1b[38;2;${cell.fg.join(";")}m` : ""}`;
	return grid.map((cells) => {
		let out = "";
		let style = "";
		for (const cell of cells) {
			const next = sgr(cell);
			if (next !== style) out += next;
			style = next;
			out += cell.ch;
		}
		return `${out}\x1b[0m`;
	});
}

export function stoppedScreen(view: StoppedView, size: { columns: number; rows: number }): string[] {
	const grid: Cell[][] = Array.from({ length: size.rows }, () => Array.from({ length: size.columns }, () => ({ ch: " " })));
	const width = Math.max(24, Math.min(CARD_MAX, size.columns - 8));
	const inner = width - 4;
	const body = cardRows(view, inner);
	const height = body.length + 2;
	const left = Math.max(0, Math.floor((size.columns - width) / 2));
	const top = Math.max(0, Math.floor((size.rows - height) / 2));
	const put = (r: number, c: number, cell: Cell) => {
		if (grid[r]?.[c]) grid[r][c] = cell;
	};
	const edge = (ch: string): Cell => ({ ch, fg: AYU.fleet });
	for (let c = 0; c < width; c++) {
		const corner = c === 0 || c === width - 1;
		put(top, left + c, edge(corner ? (c ? "╮" : "╭") : "─"));
		put(top + height - 1, left + c, edge(corner ? (c ? "╯" : "╰") : "─"));
	}
	body.forEach((cells, i) => {
		const r = top + 1 + i;
		put(r, left, edge("│"));
		cells.forEach((cell, c) => put(r, left + 2 + c, cell));
		put(r, left + width - 1, edge("│"));
	});
	return paint(grid);
}
