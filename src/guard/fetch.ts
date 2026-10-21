import { argvsOf } from "./argv.ts";
import { gitCall } from "./git.ts";

const FETCHING = new Set(["fetch", "pull"]);

export function fetchQuestion(command: string): string | undefined {
	return argvsOf(command)
		.map(gitCall)
		.some((call) => call !== undefined && FETCHING.has(call.subcommand))
		? "A git fetch or pull reaches a remote, which on the host runs only on the person's word; this dialog asks for it."
		: undefined;
}
