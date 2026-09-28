import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { loadProfiles, PROFILES, profileFor, repoName, USER_CONFIG } from "../profile/profile.ts";
import type { Host } from "./policy.ts";

const ROOT = resolve(import.meta.dirname, "../..");

function remotes(cwd: string): string[][] {
	try {
		return execFileSync("git", ["-C", cwd, "config", "--get-regexp", "^remote\\."], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
			.split("\n")
			.filter(Boolean)
			.map((line) => line.split(" "));
	} catch {
		return [];
	}
}

function real(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : undefined);

export function hostAt(cwd: string, root = ROOT, home = homedir()): Host {
	const profiles = [resolve(root, PROFILES), resolve(home, USER_CONFIG, "repos.json")];
	const levels = () => {
		const config = remotes(cwd);
		const origin = config.find(([key]) => key === "remote.origin.url")?.[1] ?? "";
		const granted = profileFor(loadProfiles(read, root, home), repoName(origin)).host;
		const ghElsewhere = ([key, value]: string[]) => {
			const [, remote, field] = /^remote\.(.+)\.([^.]+)$/.exec(key) ?? [];
			return field === "gh-resolved" || (remote !== "origin" && (field === "url" || field === "pushurl") && repoName(value) !== "");
		};
		return config.some(ghElsewhere) ? { ...granted, pr: "none" as const, merge: "none" as const } : granted;
	};
	const reaches = (path: string) => profiles.some((file) => within(file, resolve(cwd, path.replace(/^(~|\$HOME)(?=\/|$)/, home))));
	return { levels, reaches };
}

export function within(path: string, root: string): boolean {
	const rest = relative(real(root).toLowerCase(), real(path).toLowerCase());
	return !rest.startsWith("..") && !isAbsolute(rest);
}
