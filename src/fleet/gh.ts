import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { loadProfiles } from "../profile/profile.ts";
import { keychain, tokenFor } from "./tokens.ts";

const root = resolve(import.meta.dirname, "../..");
const shim = realpathSync(join(root, "bin/gh"));
const gh = (process.env.PATH ?? "")
	.split(delimiter)
	.map((dir) => join(dir, "gh"))
	.find((path) => existsSync(path) && realpathSync(path) !== shim);
if (!gh) throw new Error("no gh on PATH besides the fleet shim");

const args = process.argv.slice(2);
const env = { ...process.env };
env.GH_TOKEN ||= tokenFor(
	args,
	() => spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).stdout ?? "",
	loadProfiles((path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined), root, homedir()),
	keychain,
);
process.exitCode = spawnSync(gh, args, { stdio: "inherit", env }).status ?? 1;
