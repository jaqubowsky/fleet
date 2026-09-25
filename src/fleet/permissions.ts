import { describe, parseProfiles, PROFILES, profileFor, repoName, type Profile } from "../profile/profile.ts";
import type { Io } from "./io.ts";

export function repoProfile(root: string, name: string, io: Io): Profile {
	const text = io.read(`${root}/${PROFILES}`);
	if (text === undefined) throw new Error(`missing ${root}/${PROFILES}`);
	return profileFor(parseProfiles(text), name);
}

export type PermissionsInput = { root: string; repo: string; apply?: boolean };

export function permissions(input: PermissionsInput, io: Io): string {
	const checkout = io.stat(input.repo)?.dir ? input.repo : undefined;
	if (!checkout && !/^[^/\s]+\/[^/\s]+$/.test(input.repo)) throw new Error(`${input.repo} is neither a checkout nor owner/name`);
	const name = checkout ? repoName(io.git(["remote", "get-url", "origin"], checkout)) : input.repo;
	const profile = repoProfile(input.root, name, io);
	const text = describe(name, profile, io.harness.cli);
	if (!input.apply) return text;
	if (!checkout) throw new Error(`--apply sets a checkout; give its path, not ${input.repo}`);
	return `${text}\n${apply(checkout, name, profile, io).join("\n")}`;
}

function apply(checkout: string, name: string, profile: Profile, io: Io): string[] {
	const changes: string[] = [];
	const sign = profile.host.sign === "none" ? "false" : "true";
	let signing = "unset";
	try {
		signing = io.git(["config", "--local", "--get", "commit.gpgsign"], checkout);
	} catch {}
	if (signing !== sign) {
		io.git(["config", "--local", "commit.gpgsign", sign], checkout);
		changes.push(`commit.gpgsign ${signing} -> ${sign}`);
	}
	if (profile.host.push === "auto") {
		const origin = io.git(["remote", "get-url", "origin"], checkout);
		const https = `https://github.com/${name}.git`;
		if (origin !== https) {
			io.git(["remote", "set-url", "origin", https], checkout);
			changes.push(`origin ${origin} -> ${https}`);
		}
	}
	return changes.length ? changes : ["nothing changed"];
}
