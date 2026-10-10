export const TURNS = "logs/turns.md";
const PANE_LINES = 5;

const lastIndex = (lines: string[], word: RegExp) => lines.map((line) => word.test(line)).lastIndexOf(true);

export function turnEntry(at: Date, label: string, tail: string, closed: boolean): string {
	const lines = tail.split("\n").map((line) => line.trimEnd());
	const question = closed ? lastIndex(lines, /\bQuestion:/) : -1;
	const changes = lastIndex(lines.slice(0, question + 1), /\bChanges:/);
	const body =
		question < 0
			? lines.filter(Boolean).slice(-PANE_LINES)
			: lines.slice(changes < 0 ? question : changes, question + 1);
	return `## ${at.toISOString().replace(/\.\d{3}Z$/, "Z")} ${label}\n${body.length ? `\n${body.join("\n")}\n` : ""}`;
}

export function repeats(log: string | undefined, entry: string): boolean {
	const last = log?.split(/^(?=## )/m).at(-1)?.trimEnd();
	const timeless = (text: string) => text.replace(/^## \S+ /, "");
	return last !== undefined && timeless(last) === timeless(entry.trimEnd());
}
