import { basename, dirname, isAbsolute } from "node:path";
import type { Io } from "./io.ts";
import { FLEET } from "./home.ts";
import { parseCheckout, type Sandbox } from "./status.ts";

type Repository = {
	repo: string;
	name: string;
	base: string;
	baseSha: string;
	branch: string;
	workspace: string;
	served: string;
};

export type RepositoryManifest = {
	version: 1;
	task: string;
	repositories: Repository[];
};

export function artifactsDir(repo: string, io: Io): string {
	return `${io.home}/${FLEET.tasks}/${basename(repo)}`;
}

export function taskDir(
	repo: string,
	sandbox: string,
	io: Io,
	repos?: string[],
): string {
	const manifest = repositoryManifest(sandbox, io);
	if (
		manifest &&
		repos &&
		[repo, ...repos].join("\0") !==
			manifest.repositories.map((entry) => entry.repo).join("\0")
	)
		throw new Error(
			`${sandbox} is recorded for different repositories in ${manifestPath(sandbox, io)}; take another label, or remove that file once its task is done`,
		);
	if (manifest) return manifest.task;
	return `${artifactsDir(repo, io)}/${sandbox}`;
}

export function stopFile(sandbox: Pick<Sandbox, "name" | "workspaces">, io: Io): string {
	return `${taskDir(sandbox.workspaces[0], sandbox.name, io)}/logs/sandbox-stop.json`;
}

export function manifestPath(sandbox: string, io: Io): string {
	return `${io.home}/${FLEET.config}/fleet/${sandbox}.json`;
}

export function repositoryManifest(
	sandbox: string,
	io: Io,
): RepositoryManifest | undefined {
	const text = io.read(manifestPath(sandbox, io));
	if (text === undefined) return undefined;
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error(`${manifestPath(sandbox, io)} contains invalid JSON`);
	}
	if (
		!data ||
		typeof data !== "object" ||
		!("version" in data) ||
		data.version !== 1 ||
		!("repositories" in data) ||
		!Array.isArray(data.repositories) ||
		data.repositories.length < 1 ||
		!data.repositories.every(
			(entry: unknown) =>
				entry &&
				typeof entry === "object" &&
				["repo", "name", "base", "baseSha", "branch", "workspace", "served"].every(
					(key) =>
						key in entry &&
						typeof (entry as Record<string, unknown>)[key] === "string",
				) &&
				isAbsolute((entry as Repository).repo) &&
				isAbsolute((entry as Repository).workspace),
		) ||
		!("task" in data) ||
		typeof data.task !== "string" ||
		!isAbsolute(data.task)
	)
		throw new Error(
			`${manifestPath(sandbox, io)} is not a fleet repository manifest`,
		);
	return data as RepositoryManifest;
}

export function groupManifest(
	sandbox: string,
	io: Io,
): RepositoryManifest | undefined {
	const manifest = repositoryManifest(sandbox, io);
	return manifest && manifest.repositories.length > 1 ? manifest : undefined;
}

export function saveRepositories(
	sandbox: string,
	task: string,
	manifest: RepositoryManifest,
	io: Io,
): void {
	const path = manifestPath(sandbox, io);
	io.mkdir(dirname(path));
	const text = `${JSON.stringify(manifest, null, 2)}\n`;
	io.write(path, text);
	if (manifest.repositories.length > 1)
		io.write(`${task}/repositories.json`, text);
}

export function repositoryCheckout(
	io: Io,
	sandbox: string,
	workspace: string,
): { branch: string; dirty: number; head: string } {
	const probe =
		'cd "$1" && printf "%s\\t%s\\t%s" "$(git branch --show-current)" "$(git status --porcelain | wc -l | tr -d " ")" "$(git rev-parse HEAD)"';
	return parseCheckout(
		io.sbx(["exec", sandbox, "sh", "-c", probe, "--", workspace], {
			quiet: true,
		}),
	);
}
