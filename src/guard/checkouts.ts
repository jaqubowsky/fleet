import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WITH_PRIVATE } from "../profile/fixture.ts";

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
