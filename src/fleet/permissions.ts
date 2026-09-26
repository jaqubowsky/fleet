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

const GH_TOKEN_HELPER = "!gh auth git-credential";

function apply(checkout: string, name: string, profile: Profile, io: Io): string[] {
	const changes: string[] = [];
	const local = (key: string): string => {
		try {
			return io.git(["config", "--local", "--get", key], checkout);
		} catch {
			return "unset";
		}
	};
	const sign = profile.host.sign === "none" ? "false" : "true";
	const signing = local("commit.gpgsign");
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
		const pin = `url.${https}.insteadOf`;
		const pinned = local(pin);
		if (pinned !== https) {
			io.git(["config", "--local", "--replace-all", pin, https], checkout);
			changes.push(`${pin} ${pinned} -> ${https}`);
		}
		const helper = "credential.https://github.com.helper";
		const helping = local(helper);
		if (helping !== GH_TOKEN_HELPER) {
			io.git(["config", "--local", "--replace-all", helper, ""], checkout);
			io.git(["config", "--local", "--add", helper, GH_TOKEN_HELPER], checkout);
			changes.push(`${helper} ${helping} -> ${GH_TOKEN_HELPER}`);
		}
		const autoSetup = "branch.autoSetupMerge";
		const tracking = local(autoSetup);
		if (tracking !== "false") {
			io.git(["config", "--local", autoSetup, "false"], checkout);
			changes.push(`${autoSetup} ${tracking} -> false`);
		}
		const pushes = io.git(["remote", "get-url", "--push", "origin"], checkout);
		if (pushes !== https)
			throw new Error(`origin pushes to ${pushes}, not ${https}: a pushInsteadOf outside this checkout rewrites it, so host.push auto cannot hold here`);
	}
	return changes.length ? changes : ["nothing changed"];
}
