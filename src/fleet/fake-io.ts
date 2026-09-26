import type { Harness } from "../harness.ts";
import { HARNESSES } from "../harness.ts";
import type { Io } from "./io.ts";

type Call = [string, ...string[]];

export function fakeIo(answers: Record<string, unknown> = {}, harness: Harness = HARNESSES.pi): Io & { calls: Call[]; lines: string[]; files: Record<string, string>; sbxOpts: ({ quiet?: boolean; stream?: boolean; input?: string } | undefined)[] } {
	const calls: Call[] = [];
	const sbxOpts: ({ quiet?: boolean; stream?: boolean; input?: string } | undefined)[] = [];
	const lines: string[] = [];
	const files: Record<string, string> = {};
	const answer = (key: string): unknown => {
		const hit = Object.keys(answers)
			.filter((k) => key.startsWith(k) && !key.slice(k.length).startsWith("/"))
			.sort((a, b) => b.length - a.length)[0];
		return hit === undefined ? undefined : answers[hit];
	};
	const text = (key: string): string => {
		const a = answer(key);
		if (a instanceof Error) throw a;
		return typeof a === "string" ? a : a === undefined ? "" : JSON.stringify(a);
	};
	let tick = 0;
	return {
		calls,
		lines,
		files,
		home: "/home/me",
		harness,
		tmp: "/tmp",
		pane: "w1:host",
		env: (name) => answer(`env ${name}`) as string | undefined,
		sbxOpts,
		sbx: (args, opts) => {
			calls.push(["sbx", ...args]);
			sbxOpts.push(opts);
			return text(`sbx ${args.join(" ")}`);
		},
		herdr: <T>(args: string[]) => {
			calls.push(["herdr", ...args]);
			const a = answer(`herdr ${args.join(" ")}`);
			if (a instanceof Error) throw a;
			return (a ?? { result: {} }) as T;
		},
		herdrText: (args) => {
			calls.push(["herdr", ...args]);
			return text(`herdr ${args.join(" ")}`);
		},
		git: (args, cwd) => {
			calls.push(["git", cwd, ...args]);
			return text(`git ${args.join(" ")}`);
		},
		read: (path) => files[path] ?? (answer(`read ${path}`) as string | undefined),
		write: (path, body) => {
			calls.push(["write", path]);
			files[path] = body;
		},
		copy: (from, to) => {
			calls.push(["copy", from, to]);
			const body = files[from] ?? (answer(`read ${from}`) as string | undefined);
			if (body !== undefined) files[to] = body;
		},
		remove: (path) => {
			calls.push(["remove", path]);
			for (const file of Object.keys(files)) if (file === path || file.startsWith(`${path}/`)) delete files[file];
		},
		list: (dir) => (answer(`list ${dir}`) as string[] | undefined) ?? [],
		stat: (path) => answer(`stat ${path}`) as { size: number; mtime: Date; dir: boolean } | undefined,
		append: (path, line) => {
			calls.push(["append", path, line]);
		},
		mkdir: (path) => {
			calls.push(["mkdir", path]);
		},
		log: (line) => {
			lines.push(line);
		},
		run: (command, args) => {
			calls.push(["run", command, ...args]);
		},
		launch: async (command, args) => {
			calls.push(["launch", command, ...args]);
			return 0;
		},
		sleep: async () => {
			tick += 1;
		},
		now: () => new Date(Date.UTC(2026, 8, 16, 10, 0, tick * 2)),
	};
}
