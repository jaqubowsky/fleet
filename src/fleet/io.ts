import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Io = {
	sbx(args: string[], opts?: { quiet?: boolean; stream?: boolean }): string;
	herdr<T = unknown>(args: string[]): T;
	herdrText(args: string[]): string;
	git(args: string[], cwd: string): string;
	read(path: string): string | undefined;
	write(path: string, text: string): void;
	list(dir: string): string[];
	stat(path: string): { size: number; mtime: Date; dir: boolean } | undefined;
	append(path: string, line: string): void;
	mkdir(path: string): void;
	log(line: string): void;
	run(command: string, args: string[]): void;
	sleep(ms: number): Promise<void>;
	now(): Date;
	home: string;
	tmp: string;
	pane: string;
};

function shell(cmd: string, args: string[], opts: { quiet?: boolean; stream?: boolean; cwd?: string } = {}): string {
	const result = spawnSync(cmd, args, {
		cwd: opts.cwd,
		input: "",
		encoding: "utf8",
		stdio: ["pipe", opts.stream ? "inherit" : "pipe", opts.quiet ? "pipe" : "inherit"],
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		const shown = args.map((a) => (a.length > 80 ? `${a.slice(0, 77)}...` : a)).join(" ");
		const tail = [opts.quiet ? result.stderr : "", result.stdout].filter(Boolean).join("\n").trim().split("\n").slice(-20).join("\n");
		throw new Error(`${cmd} ${shown} failed (${result.status})${tail ? `\n${tail}` : ""}`);
	}
	return (result.stdout ?? "").trim();
}

export function realIo(home: string): Io {
	return {
		sbx: (args, opts) => shell("sbx", args, opts),
		herdr: <T>(args: string[]) => {
			const out = shell("herdr", args, { quiet: true });
			return (out ? JSON.parse(out) : {}) as T;
		},
		herdrText: (args) => shell("herdr", args, { quiet: true }),
		git: (args, cwd) => shell("git", args, { cwd, quiet: true }),
		read: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
		write: (path, text) => writeFileSync(path, text),
		list: (dir) => {
			try {
				return readdirSync(dir);
			} catch {
				return [];
			}
		},
		stat: (path) => {
			try {
				const info = statSync(path);
				return { size: info.size, mtime: info.mtime, dir: info.isDirectory() };
			} catch {
				return undefined;
			}
		},
		append: (path, line) => {
			mkdirSync(dirname(path), { recursive: true });
			appendFileSync(path, `${line}\n`);
		},
		mkdir: (path) => mkdirSync(path, { recursive: true }),
		log: (line) => console.log(line),
		run: (command, args) => {
			const result = spawnSync(command, args, { stdio: "inherit" });
			if (result.error) throw result.error;
			if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
		},
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		now: () => new Date(),
		home,
		tmp: process.env.TMPDIR ?? "/tmp",
		pane: process.env.HERDR_PANE_ID ?? "-",
	};
}
