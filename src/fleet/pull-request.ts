import { PULL_REQUEST } from "../../extensions/activity.ts";
import type { Io } from "./io.ts";
import { taskDir } from "./repositories.ts";
import { tabContainer } from "./status.ts";

const GITHUB_PULL_REQUEST = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;

function addressIn(text: string | undefined): string | undefined {
	try {
		const { url } = JSON.parse(text ?? "");
		if (typeof url === "string" && GITHUB_PULL_REQUEST.test(url)) return url;
	} catch {}
	return undefined;
}

export function openPullRequest(name: string | undefined, paneId: string | undefined, io: Io): void {
	const current = io.herdr<{ result: { pane: { tab_id: string; workspace_id: string } } }>(["pane", "current", ...(paneId ? ["--pane", paneId] : ["--current"])]).result.pane;
	const sandbox = tabContainer(name, current, io);
	if (!sandbox) throw new Error("Select a Fleet container tab, or run fleet pr <sandbox> from the target pane");
	const url = addressIn(io.read(`${taskDir(sandbox.workspaces[0], sandbox.name, io)}/${PULL_REQUEST}`));
	if (!url) throw new Error(`${sandbox.name} has opened no pull request with gh pr create`);
	io.run("open", [url]);
}
