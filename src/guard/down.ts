import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { Host as ProfileHost } from "../profile/profile.ts";
import { agentName } from "../fleet/name.ts";
import { argvsOf } from "./argv.ts";
import { hostAt } from "./host.ts";

type DownTarget = { sandbox: string; level: ProfileHost["down"] };
type DownVerdict = {
	decision: "allow" | "ask" | "deny";
	reason: string;
	sandbox?: string;
};

const BARE = /^fleet down (?:(--force) )?([A-Za-z0-9][\w.-]*)(?: (--force))?$/;

export function downPermission(
	command: string,
	lookup: (sandbox: string) => DownTarget | undefined,
): DownVerdict | undefined {
	const invokesDown = argvsOf(command).some(
		(argv) =>
			(/(?:^|\/)fleet$/.test(argv[0] ?? "") && argv[1] === "down") ||
			(/(?:^|\/)sh$/.test(argv[0] ?? "") &&
				argv.includes("--") &&
				argv.some((part, i) => part === "fleet" && argv[i + 1] === "down")),
	);
	if (!invokesDown) return undefined;
	const match = BARE.exec(command);
	if (!match)
		return {
			decision: "deny",
			reason:
				"Run fleet down bare, on one line with one sandbox name; no shell wrappers or other commands.",
		};
	if (match[1] || match[3])
		return {
			decision: "deny",
			reason:
				"An agent cannot force-close a container; only the person runs fleet down --force.",
		};
	const target = lookup(match[2]);
	if (target?.level === "auto")
		return {
			decision: "allow",
			reason:
				"The host profile lets this agent decide when to close the container.",
			sandbox: target.sandbox,
		};
	if (target?.level === "human")
		return {
			decision: "ask",
			reason: `Ask the person before closing ${target.sandbox}.`,
			sandbox: target.sandbox,
		};
	return {
		decision: "deny",
		reason:
			target?.level === "none"
				? "The host profile leaves fleet down to the person."
				: `No host down permission could be read for ${match[2]}.`,
	};
}

export function sandboxDownTarget(
	sandbox: string,
	root = resolve(import.meta.dirname, "../.."),
	home = homedir(),
	list = () =>
		execFileSync("sbx", ["ls", "--json"], { encoding: "utf8", timeout: 5000 }),
): DownTarget | undefined {
	let listed: { sandboxes?: { name?: string; workspaces?: string[] }[] };
	try {
		listed = JSON.parse(list()) as typeof listed;
	} catch {
		return undefined;
	}
	const entry = listed.sandboxes?.find(
		(item) =>
			item.name === sandbox || (item.name && agentName(item.name) === sandbox),
	);
	const workspace = entry?.workspaces?.[0];
	return entry?.name && workspace
		? { sandbox: entry.name, level: hostAt(workspace, root, home).levels().down }
		: undefined;
}
