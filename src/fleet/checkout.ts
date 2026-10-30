import { basename } from "node:path";
import type { Io } from "./io.ts";
import { repositoryManifest } from "./repositories.ts";
import { sandboxes } from "./status.ts";

export type Checkout = { workspace: string; base: string; prefix: string };

export function withoutTerminalControls(text: string): string {
	return text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}

export function checkouts(name: string, io: Io): Checkout[] | undefined {
	if (sandboxes(io).find(s => s.name === name)?.status !== "running") return undefined;
	const repositories = repositoryManifest(name, io)?.repositories ?? [];
	return repositories.length
		? repositories.map(r => ({ workspace: r.workspace, base: `refs/remotes/origin/${r.base}`, prefix: repositories.length > 1 ? `${basename(r.repo)}/` : "" }))
		: [{ workspace: "", base: "", prefix: "" }];
}
