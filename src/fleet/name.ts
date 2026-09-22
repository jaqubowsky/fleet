import { createHash } from "node:crypto";
import { basename } from "node:path";
import { HARNESSES } from "../harness.ts";

const PREFIXES = new RegExp(`^(${Object.values(HARNESSES).map((h) => h.prefix).join("|")})`);

export function slug(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function sandboxName(repo: string, label: string, prefix: string): string {
	const project = slug(basename(repo)) || "repo";
	const suffix = slug(label);
	if (!suffix) throw new Error("a container needs a label, for example the ticket id");
	return `${prefix}${project}-${suffix}`.slice(0, 63);
}

export function agentName(sandbox: string): string {
	const name = sandbox.replace(PREFIXES, "");
	if (name.length <= 32) return name;
	return `${name.slice(0, 24).replace(/-+$/, "")}-${createHash("sha256").update(name).digest("hex").slice(0, 7)}`;
}
