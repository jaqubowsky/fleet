import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Harness } from "../harness.ts";

export type Io = {
	sbx(args: string[], opts?: { quiet?: boolean; stream?: boolean; timeoutMs?: number; input?: string }): string;
	herdr<T = unknown>(args: string[]): T;
	herdrText(args: string[]): string;
	git(args: string[], cwd: string): string;
	gh(args: string[], cwd: string): string;
	read(path: string): string | undefined;
	write(path: string, text: string): void;
	copy(from: string, to: string): void;
	remove(path: string): void;
	list(dir: string): string[];
	stat(path: string): { size: number; mtime: Date; dir: boolean } | undefined;
	append(path: string, line: string): void;
	mkdir(path: string): void;
	log(line: string): void;
	run(command: string, args: string[], cwd?: string): void;
	launch(command: string, args: string[]): Promise<number>;
	sleep(ms: number): Promise<void>;
	now(): Date;
	home: string;
	harness: Harness;
	tmp: string;
	pane: string;
	sessionId?: string;
	env(name: string): string | undefined;
};

function shell(cmd: string, args: string[], opts: { quiet?: boolean; stream?: boolean; cwd?: string; timeoutMs?: number; input?: string } = {}): string {
	const result = spawnSync(cmd, args, {
		cwd: opts.cwd,
		input: opts.input ?? "",
		encoding: "utf8",
		stdio: ["pipe", opts.stream ? "inherit" : "pipe", opts.quiet ? "pipe" : "inherit"],
		timeout: opts.timeoutMs,
	});
	const shown = args.map((a) => (a.length > 80 ? `${a.slice(0, 77)}...` : a)).join(" ");
	if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") throw new Error(`${cmd} ${shown} gave no answer within ${(opts.timeoutMs ?? 0) / 1000}s`);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		const tail = [opts.quiet ? result.stderr : "", result.stdout].filter(Boolean).join("\n").trim().split("\n").slice(-20).join("\n");
		throw new Error(`${cmd} ${shown} failed (${result.status})${tail ? `\n${tail}` : ""}`);
	}
	return (result.stdout ?? "").trim();
}

export function realIo(home: string, harness: Harness): Io {
	return {
		sbx: (args, opts) => shell("sbx", args, opts),
		herdr: <T>(args: string[]) => {
			const out = shell("herdr", args, { quiet: true });
			try {
				return (out ? JSON.parse(out) : {}) as T;
			} catch (cause) {
				throw new Error("herdr returned invalid JSON", { cause });
			}
		},
		herdrText: (args) => shell("herdr", args, { quiet: true }),
		git: (args, cwd) => shell("git", args, { cwd, quiet: true }),
		gh: (args, cwd) => shell("gh", args, { cwd, quiet: true, timeoutMs: 30_000 }),
		read: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
		write: (path, text) => writeFileSync(path, text),
		copy: (from, to) => {
			copyFileSync(from, to);
			chmodSync(to, statSync(from).mode);
		},
		remove: (path) => rmSync(path, { recursive: true, force: true }),
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
		run: (command, args, cwd) => {
			const result = spawnSync(command, args, { cwd, stdio: "inherit" });
			if (result.error) throw result.error;
			if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
		},
		launch: (command, args) =>
			new Promise((resolve, reject) => {
				const child = spawn(command, args, { stdio: "inherit" });
				child.on("error", reject);
				child.on("exit", (code) => resolve(code ?? 1));
			}),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		now: () => new Date(),
		home,
		harness,
		tmp: process.env.TMPDIR ?? "/tmp",
		pane: process.env.HERDR_PANE_ID ?? "-",
		sessionId: harness.sessionIdEnv ? process.env[harness.sessionIdEnv] : undefined,
		env: (name) => process.env[name] || undefined,
	};
}
