import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseProfiles, PROFILES, profileFor, repoName } from "../profile/profile.ts";
import type { HostLevels } from "./policy.ts";

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

export function levelsAt(cwd: string, root = ROOT): () => HostLevels {
	return () => {
		const config = remotes(cwd);
		const origin = config.find(([key]) => key === "remote.origin.url")?.[1] ?? "";
		const host = profileFor(parseProfiles(readFileSync(resolve(root, PROFILES), "utf8")), repoName(origin)).host;
		const ghTargetsOrigin = config.every(([key]) => key.startsWith("remote.origin.") && key !== "remote.origin.gh-resolved");
		return ghTargetsOrigin ? host : { ...host, pr: "none", merge: "none" };
	};
}
