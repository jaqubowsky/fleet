import { argvsOf } from "./argv.ts";

type LandPermission = {
	decision: "ask" | "deny";
	reason: string;
	sandbox?: string;
	action?: "import" | "sign" | "push" | "import, sign and push";
};

const BARE =
	/^fleet land(?: (?:--sign|--push|--repo [A-Za-z0-9_./-]+|--branch [A-Za-z0-9_./-]+))* ([A-Za-z0-9][\w.-]*)(?: (?:--sign|--push|--repo [A-Za-z0-9_./-]+|--branch [A-Za-z0-9_./-]+))*$/;

export function landPermission(command: string): LandPermission | undefined {
	const invokesLand = argvsOf(command).some(
		(argv) =>
			(/(?:^|\/)fleet$/.test(argv[0] ?? "") && argv[1] === "land") ||
			(/(?:^|\/)sh$/.test(argv[0] ?? "") &&
				argv.includes("--") &&
				argv.some((part, i) => part === "fleet" && argv[i + 1] === "land")),
	);
	if (!invokesLand) return undefined;
	const match = BARE.exec(command);
	if (!match)
		return {
			decision: "deny",
			reason:
				"Run fleet land bare, on one line with one sandbox name; no shell wrappers or other commands.",
		};
	const sandbox = match[1];
	const signs = command.includes(" --sign");
	const pushes = command.includes(" --push");
	const action =
		signs && pushes
			? "import, sign and push"
			: pushes
				? "push"
				: signs
					? "sign"
					: "import";
	return {
		decision: "ask",
		reason: `Ask the person before the ${action} for ${sandbox}.`,
		sandbox,
		action,
	};
}
