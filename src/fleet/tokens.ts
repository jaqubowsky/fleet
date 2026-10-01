import { spawnSync } from "node:child_process";
import { type Profile, profileFor, repoName } from "../profile/profile.ts";

type Profiles = Record<string, Profile>;
type Keychain = { read(ref: string): string | undefined; write(ref: string, value: string): void };

const SERVICE = "fleet-gh";

export const keychain: Keychain = {
	read(ref) {
		const found = spawnSync("security", ["find-generic-password", "-s", SERVICE, "-a", ref, "-w"], { encoding: "utf8" });
		return found.status === 0 ? found.stdout.trim() : undefined;
	},
	write(ref, value) {
		const added = spawnSync("security", ["-i"], {
			input: `add-generic-password -U -s ${SERVICE} -a "${ref}" -w "${value}"\n`,
			encoding: "utf8",
		});
		if (added.status !== 0) throw new Error(`the keychain refused ${ref}: ${added.stderr.trim()}`);
	},
};

export function opRead(ref: string): string {
	const read = spawnSync("op", ["read", "--no-newline", ref], { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
	if (read.status !== 0) throw new Error(`op read ${ref} failed`);
	return read.stdout;
}

export function tokenRefs(profiles: Profiles): string[] {
	const refs = Object.values(profiles).map((profile) => profile.container.token);
	return [...new Set(refs.filter((ref) => ref.startsWith("op://")))].sort();
}

function repoFlag(args: string[]): string | undefined {
	for (const [i, arg] of args.entries()) {
		if (arg === "-R" || arg === "--repo") return args[i + 1];
		if (arg.startsWith("--repo=")) return arg.slice("--repo=".length);
		if (arg.startsWith("-R")) return arg.slice(2);
	}
}

export function tokenFor(args: string[], origin: () => string, profiles: Profiles, keychain: Keychain): string | undefined {
	const ref = profileFor(profiles, repoFlag(args) ?? repoName(origin())).container.token;
	return ref.startsWith("op://") ? keychain.read(ref) : undefined;
}

export function syncTokens(profiles: Profiles, opRead: (ref: string) => string, keychain: Keychain): string[] {
	return tokenRefs(profiles).map((ref) => {
		keychain.write(ref, opRead(ref));
		return `copied ${ref}`;
	});
}
