import { promptAgent } from "./commands.ts";
import { diffPatchPath } from "./diff-view.ts";
import type { Io } from "./io.ts";
import { taskDir } from "./repositories.ts";
import { tabContainer } from "./status.ts";

type Range = [number, number];
type Note = { noteId: string; filePath?: string; newRange?: Range; oldRange?: Range; body: string };

const HEADER = "# Review notes\n\nThe person's notes on the diff, each with its file and the diff lines it sits on.\n";

const lines = ([first, last]: Range) => (first === last ? `line ${first}` : `lines ${first}-${last}`);

function where(note: Note): string {
	const place = note.newRange ? ` ${lines(note.newRange)}` : note.oldRange ? ` removed ${lines(note.oldRange)}` : "";
	return note.filePath ? `\`${note.filePath}\`${place}` : "a reply";
}

export function sendReviewNotes(name: string | undefined, paneId: string | undefined, io: Io): void {
	const current = io.herdr<{ result: { pane: { tab_id: string; workspace_id: string } } }>(["pane", "current", ...(paneId ? ["--pane", paneId] : ["--current"])]).result.pane;
	const sandbox = tabContainer(name, current, io);
	if (!sandbox) throw new Error("Select a Fleet container tab, or run fleet notes <sandbox> from the target pane");
	const patch = diffPatchPath(sandbox.name, io);
	const { sessions = [] } = JSON.parse(io.hunk(["session", "list", "--json"])) as { sessions?: { sessionId: string; sourceLabel?: string }[] };
	const session = sessions.find((s) => s.sourceLabel === patch);
	if (!session) throw new Error(`Open ${sandbox.name}'s Changes pane with Ctrl+B then D and write notes there with c`);
	const { comments = [] } = JSON.parse(io.hunk(["session", "comment", "list", session.sessionId, "--type", "user", "--json"])) as { comments?: Note[] };
	if (!comments.length) throw new Error(`${sandbox.name}: no review notes in its Changes pane`);
	const file = `${taskDir(sandbox.workspaces[0], sandbox.name, io)}/review-notes.md`;
	const round = [`## ${io.now().toISOString()}`, "", ...comments.map((note) => `- ${where(note)}: ${note.body.replace(/\s+/g, " ").trim()}`)].join("\n");
	const before = io.read(file);
	io.write(file, `${before ?? HEADER}\n${round}\n`);
	try {
		promptAgent(sandbox, `Address the person's review notes in ${file}, under its last heading.`, io);
	} catch (error) {
		if (before === undefined) io.remove(file);
		else io.write(file, before);
		throw error;
	}
	for (const note of [...comments].reverse()) io.hunk(["session", "comment", "rm", session.sessionId, note.noteId, "--json"]);
}
