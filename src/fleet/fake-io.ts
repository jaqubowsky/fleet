import { SEATS, type Seat } from "../harness.ts";
import type { Io } from "./io.ts";

type Call = [string, ...string[]];
type FixtureAnswer =
	| string
	| number
	| boolean
	| null
	| Error
	| Record<string, unknown>
	| unknown[]
	| undefined;

export function fakeIo(
	answers: Record<string, unknown> = {},
	seat: Seat = SEATS.pi,
): Io & {
	calls: Call[];
	lines: string[];
	files: Record<string, string>;
	sbxOpts: ({ quiet?: boolean; stream?: boolean; input?: string } | undefined)[];
	followers: { args: string[]; onLine: (line: string) => void; onClose: () => void; stopped: boolean }[];
} {
	const calls: Call[] = [];
	const sbxOpts: (
		| { quiet?: boolean; stream?: boolean; input?: string }
		| undefined
	)[] = [];
	const lines: string[] = [];
	const followers: { args: string[]; onLine: (line: string) => void; onClose: () => void; stopped: boolean }[] = [];
	const files: Record<string, string> = {};
	const answer = (key: string): FixtureAnswer => {
		const hit = Object.keys(answers)
			.filter((k) => key.startsWith(k) && !key.slice(k.length).startsWith("/"))
			.sort((a, b) => b.length - a.length)[0];
		return hit === undefined ? undefined : (answers[hit] as FixtureAnswer);
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
		seat,
		tmp: "/tmp",
		terminal: "t1",
		followers,
		env: (name) => answer(`env ${name}`) as string | undefined,
		sbxOpts,
		sbx: (args, opts) => {
			calls.push(["sbx", ...args]);
			sbxOpts.push(opts);
			return text(`sbx ${args.join(" ")}`);
		},
		hc: <T>(args: string[]) => {
			calls.push(["hc", ...args]);
			const a = answer(`hc ${args.join(" ")}`);
			if (a instanceof Error) throw a;
			return (a ?? {}) as T;
		},
		hcText: (args) => {
			calls.push(["hc", ...args]);
			return text(`hc ${args.join(" ")}`);
		},
		app: <T>(args: string[]) => {
			calls.push(["herdr-app", ...args]);
			const a = answer(`herdr-app ${args.join(" ")}`);
			if (a instanceof Error) throw a;
			return (a ?? {}) as T;
		},
		follow: (command, args, onLine, onClose) => {
			calls.push(["follow", command, ...args]);
			const follower = { args: [command, ...args], onLine, onClose, stopped: false };
			followers.push(follower);
			return () => {
				follower.stopped = true;
			};
		},
		git: (args, cwd) => {
			calls.push(["git", cwd, ...args]);
			const scoped = `git ${cwd} ${args.join(" ")}`;
			return answer(scoped) === undefined
				? text(`git ${args.join(" ")}`)
				: text(scoped);
		},
		gh: (args, cwd) => {
			calls.push(["gh", cwd, ...args]);
			return text(`gh ${args.join(" ")}`);
		},
		read: (path) => files[path] ?? (answer(`read ${path}`) as string | undefined),
		write: (path, body) => {
			calls.push(["write", path]);
			files[path] = body;
		},
		rename: (from, to) => {
			calls.push(["rename", from, to]);
			files[to] = files[from];
			delete files[from];
		},
		copy: (from, to) => {
			calls.push(["copy", from, to]);
			const body = files[from] ?? (answer(`read ${from}`) as string | undefined);
			if (body !== undefined) files[to] = body;
		},
		remove: (path) => {
			calls.push(["remove", path]);
			for (const file of Object.keys(files))
				if (file === path || file.startsWith(`${path}/`)) delete files[file];
		},
		list: (dir) => (answer(`list ${dir}`) as string[] | undefined) ?? [],
		stat: (path) =>
			answer(`stat ${path}`) as
				| { size: number; mtime: Date; dir: boolean }
				| undefined,
		append: (path, line) => {
			calls.push(["append", path, line]);
		},
		mkdir: (path) => {
			calls.push(["mkdir", path]);
		},
		log: (line) => {
			lines.push(line);
		},
		run: (command, args, cwd) => {
			calls.push(["run", ...(cwd === undefined ? [] : [cwd]), command, ...args]);
		},
		sleep: async () => {
			tick += 1;
		},
		now: () => new Date(Date.UTC(2026, 8, 16, 10, 0, tick * 2)),
	};
}

export function liveTerminals(...sandboxes: (string | [string, string | null])[]): Record<string, unknown> {
	const terminals = sandboxes.map((entry, index) => {
		const [name, state] = Array.isArray(entry) ? entry : [entry, "idle"];
		return { address: `t${index + 2}`, labels: { fleet: "1", "fleet.sandbox": name }, status: state ? { state } : null, turn: 0 };
	});
	return {
		"hc ls --label fleet=1": { terminals: terminals.map(({ address, status, turn }) => ({ address, state: "live", status: status?.state ?? null, turn })) },
		...Object.fromEntries(terminals.map((terminal) => [`hc get ${terminal.address}`, { ...terminal, state: "live" }])),
	};
}
