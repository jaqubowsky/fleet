import { dirname } from "node:path";
import type { Io } from "./io.ts";

export function init(input: { root: string; repo: string }, io: Io): void {
	const seed = `${input.root}/templates/project`;
	const files = (dir: string): string[] =>
		io
			.list(`${seed}/${dir}`)
			.sort()
			.flatMap((name) => {
				const path = dir ? `${dir}/${name}` : name;
				return io.stat(`${seed}/${path}`)?.dir ? files(path) : [path];
			});
	for (const path of files("")) {
		const target = `${input.repo}/${path}`;
		if (io.stat(target)) {
			io.log(`left ${path}`);
			continue;
		}
		io.mkdir(dirname(target));
		io.copy(`${seed}/${path}`, target);
		io.log(`laid out ${path}`);
	}
}
