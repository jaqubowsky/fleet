import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { parseProfiles, PROFILES, profileFor, repoName } from "../profile/profile.ts";
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

export function hostAt(cwd: string, root = ROOT): Host {
	const profiles = resolve(root, PROFILES);
	const levels = () => {
		const config = remotes(cwd);
		const origin = config.find(([key]) => key === "remote.origin.url")?.[1] ?? "";
		const granted = profileFor(parseProfiles(readFileSync(profiles, "utf8")), repoName(origin)).host;
		const ghElsewhere = ([key, value]: string[]) => {
			const [, remote, field] = /^remote\.(.+)\.([^.]+)$/.exec(key) ?? [];
			return field === "gh-resolved" || (remote !== "origin" && (field === "url" || field === "pushurl") && repoName(value) !== "");
		};
		return config.some(ghElsewhere) ? { ...granted, pr: "none" as const, merge: "none" as const } : granted;
	};
	const reaches = (path: string) => {
		const rest = relative(real(resolve(cwd, path.replace(/^(~|\$HOME)(?=\/|$)/, homedir()))).toLowerCase(), real(profiles).toLowerCase());
		return !rest.startsWith("..") && !isAbsolute(rest);
	};
	return { levels, reaches };
}
