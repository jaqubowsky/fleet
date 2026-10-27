import { createHash } from "node:crypto";
import { basename } from "node:path";

export function slug(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function sandboxName(repo: string, label: string, prefix: string): string {
	const project = slug(basename(repo)) || "repo";
	const suffix = slug(label);
	if (!suffix) throw new Error("a container needs a label, for example the ticket id");
	return `${prefix}${project}-${suffix}`.slice(0, 63).replace(/[^a-z0-9]+$/, "");
}

export function labelInSandboxName(repo: string, label: string, prefix: string): string | undefined {
	const head = sandboxName(repo, "x", prefix).slice(0, -1);
	const suffix = slug(label);
	return suffix.startsWith(head) && suffix.length > head.length ? suffix.slice(head.length) : undefined;
}

export function agentName(sandbox: string): string {
	if (sandbox.length <= 32) return sandbox;
	return `${sandbox.slice(0, 24).replace(/-+$/, "")}-${createHash("sha256").update(sandbox).digest("hex").slice(0, 7)}`;
}
