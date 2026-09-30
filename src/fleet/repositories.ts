import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute } from "node:path";
import { repoName } from "../profile/profile.ts";
import { slug } from "./name.ts";
import type { Io } from "./io.ts";
import { parseCheckout } from "./status.ts";

type Repository = {
	repo: string;
	name: string;
	base: string;
	baseSha: string;
	branch: string;
	workspace: string;
	served: string;
	sourceSha?: string;
	landedSha?: string;
	signedSha?: string;
	pushedSha?: string;
};

export type RepositoryManifest = {
	version: 1;
	task?: string;
	repositories: Repository[];
};

export function artifactsDir(repo: string, io: Io): string {
	return `${io.home}/.sandboxes/${basename(repo)}`;
}

function groupArtifactsDir(repos: string[], io: Io): string {
	const names = repos
		.map((repo) =>
			repoName(io.git(["remote", "get-url", "origin"], repo)).toLowerCase(),
		)
		.sort();
	if (names.some((name) => !name) || new Set(names).size !== names.length)
		throw new Error("a multi-repository task needs distinct GitHub origins");
	const label = names
		.map((name) => slug(name.split("/").at(-1)!).slice(0, 48))
		.join("--")
		.slice(0, 140);
	const hash = createHash("sha256")
		.update(names.join("\0"))
		.digest("hex")
		.slice(0, 12);
	return `${io.home}/.sandboxes/groups/${label}-${hash}`;
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
	if (manifest)
		return (
			manifest.task ??
			`${artifactsDir(manifest.repositories[0].repo, io)}/${sandbox}`
		);
	const root = repos?.length
		? groupArtifactsDir([repo, ...repos], io)
		: artifactsDir(repo, io);
	return `${root}/${sandbox}`;
}

export function manifestPath(sandbox: string, io: Io): string {
	return `${io.home}/.config/harness/fleet/${sandbox}.json`;
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
		("task" in data && (typeof data.task !== "string" || !isAbsolute(data.task)))
	)
		throw new Error(
			`${manifestPath(sandbox, io)} is not a fleet repository manifest`,
		);
	return data as RepositoryManifest;
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
