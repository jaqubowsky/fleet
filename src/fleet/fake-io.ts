import type { Io } from "./io.ts";

export type Call = [string, ...string[]];

export function fakeIo(answers: Record<string, unknown> = {}): Io & { calls: Call[]; lines: string[]; files: Record<string, string>; sbxOpts: ({ quiet?: boolean; stream?: boolean } | undefined)[] } {
	const calls: Call[] = [];
	const sbxOpts: ({ quiet?: boolean; stream?: boolean } | undefined)[] = [];
	const lines: string[] = [];
	const files: Record<string, string> = {};
	const answer = (key: string): unknown => {
		const hit = Object.keys(answers).find((k) => key.startsWith(k));
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
		tmp: "/tmp",
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
		sleep: async () => {
			tick += 1;
		},
		now: () => new Date(Date.UTC(2026, 8, 16, 10, 0, tick * 2)),
	};
}
