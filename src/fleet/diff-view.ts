import { dirname } from "node:path";
import { containerPatch } from "./diff.ts";
import { FLEET } from "./home.ts";
import type { Io } from "./io.ts";

const READ_MS = 2000;

export async function diffView(name: string, io: Io): Promise<void> {
	const patch = `${io.home}/${FLEET.cache}/diff/${name}.patch`;
	io.mkdir(dirname(patch));
	let shown = io.read(patch);
	const show = () => {
		let next: string | undefined;
		try {
			next = containerPatch(name, io);
		} catch {
			return;
		}
		if (next === undefined || next === shown) return;
		io.write(`${patch}.next`, next);
		io.rename(`${patch}.next`, patch);
		shown = next;
	};
	show();
	if (shown === undefined) io.write(patch, "");
	let reading: NodeJS.Timeout | undefined;
	const read = () => {
		show();
		reading = setTimeout(read, READ_MS);
	};
	reading = setTimeout(read, READ_MS);
	try {
		await io.launch("hunk", ["patch", patch, "--watch", "--mode", "split", "--sidebar", "--wrap", "--theme", "ayu-mirage"]);
	} finally {
		clearTimeout(reading);
	}
	if (io.pane !== "-") io.herdr(["pane", "close", io.pane]);
}
