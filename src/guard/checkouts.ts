import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { today, WITH_PRIVATE } from "../profile/fixture.ts";
import { hostAt } from "./host.ts";
import type { Host, HostLevels } from "./policy.ts";

export const EMPTY_HOME = mkdtempSync(join(tmpdir(), "guard-home-"));

export const at = (levels: HostLevels): Host => ({ ...hostAt(resolve(import.meta.dirname, "../.."), undefined, EMPTY_HOME), levels: () => levels });

export const here = at(today());

export function checkout(origin: string): string {
	const dir = mkdtempSync(join(tmpdir(), "guard-checkout-"));
	execFileSync("git", ["init", "--quiet", dir]);
	execFileSync("git", ["-C", dir, "remote", "add", "origin", origin]);
	return dir;
}

export function privateRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "guard-root-"));
	mkdirSync(join(root, "host"));
	writeFileSync(join(root, "host", "repos.json"), WITH_PRIVATE);
	return root;
}
