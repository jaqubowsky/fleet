import { spawnSync } from "node:child_process";
import { CLI } from "../harness.ts";
import { KEYCHAIN_NAME, type Profile, keychainName, profileFor, repoName } from "../profile/profile.ts";

type Profiles = Record<string, Profile>;
type Keychain = {
	has(name: string): boolean;
	read(name: string): string | undefined;
	write(name: string, value: string): void;
};

const SERVICE = "fleet-gh";

export const keychainRead = (name: string) => `security find-generic-password -s ${SERVICE} -a ${name} -w`;

export const keychain: Keychain = {
	has(name) {
		return spawnSync("security", ["find-generic-password", "-s", SERVICE, "-a", name], { stdio: "ignore" }).status === 0;
	},
	read(name) {
		const found = spawnSync("security", ["find-generic-password", "-s", SERVICE, "-a", name, "-w"], { encoding: "utf8" });
		return found.status === 0 ? found.stdout.trim() : undefined;
	},
	write(name, value) {
		const added = spawnSync("security", ["-i"], {
			input: `add-generic-password -U -s ${SERVICE} -a "${name}" -w "${value}"\n`,
			encoding: "utf8",
		});
		if (added.status !== 0) throw new Error(`the keychain refused ${name}: ${added.error?.message ?? added.stderr.trim()}`);
	},
};

export function askHidden(prompt: string): string {
	process.stderr.write(prompt);
	const read = spawnSync("sh", ["-c", `trap 'stty echo 2>/dev/null' EXIT; trap 'exit 130' INT TERM; stty -echo 2>/dev/null; IFS= read -r value; printf %s "$value"`], {
		stdio: ["inherit", "pipe", "inherit"],
		encoding: "utf8",
	});
	process.stderr.write("\n");
	if (read.status !== 0) throw new Error("no token read from the terminal");
	return read.stdout;
}

function tokenNames(profiles: Profiles): string[] {
	const names = Object.values(profiles).map((profile) => keychainName(profile.container.token));
	return [...new Set(names.filter((name) => name !== undefined))].sort();
}

function repoFlag(args: string[]): string | undefined {
	for (const [i, arg] of args.entries()) {
		if (arg === "-R" || arg === "--repo") return args[i + 1];
		if (arg.startsWith("--repo=")) return arg.slice("--repo=".length);
		if (arg.startsWith("-R")) return arg.slice(2);
	}
}

export function tokenFor(args: string[], origin: () => string, profiles: Profiles, keychain: Keychain): string | undefined {
	const name = keychainName(profileFor(profiles, repoFlag(args) ?? repoName(origin())).container.token);
	return name ? keychain.read(name) : undefined;
}

export function listTokens(profiles: Profiles, keychain: Keychain): string[] {
	const names = tokenNames(profiles);
	if (!names.length) return ["no profile names a keychain:<name> token"];
	return names.map((name) => `keychain:${name}  ${keychain.has(name) ? "stored" : `missing: ${CLI} tokens set ${name}`}`);
}

export function setToken(name: string, ask: () => string, keychain: Keychain): string {
	if (!KEYCHAIN_NAME.test(name)) throw new Error(`${name} is no keychain token name: a name matches ${KEYCHAIN_NAME.source}`);
	const token = ask().trim();
	if (!token) throw new Error(`the token for ${name} is empty`);
	if (/["\n\r]/.test(token)) throw new Error(`the token for ${name} holds a quote or a line break, which the keychain's command line would misread`);
	keychain.write(name, token);
	return `stored keychain:${name}`;
}
