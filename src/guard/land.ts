import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { realIo } from "../fleet/io.ts";
import { projectOverlay } from "../fleet/permissions.ts";
import { repoName } from "../profile/profile.ts";
import { argvsOf, untrimmed } from "./argv.ts";
import { sandboxRepositories, type SandboxList } from "./down.ts";

type LandPermission = {
	decision: "allow" | "ask" | "deny";
	reason: string;
	sandbox?: string;
	action?:
		| "import, signing per profile"
		| "import and sign"
		| "import and push, signing per profile"
		| "import, sign and push";
};

const BARE =
	/^fleet land(?: (?:--sign|--push|--repo [A-Za-z0-9_./-]+|--branch [A-Za-z0-9_./-]+|--base [A-Za-z0-9_./-]+))* ([A-Za-z0-9][\w.-]*)(?: (?:--sign|--push|--repo [A-Za-z0-9_./-]+|--branch [A-Za-z0-9_./-]+|--base [A-Za-z0-9_./-]+))*$/;

export function landPermission(
	command: string,
	standing: (sandbox: string) => boolean = () => false,
): LandPermission | undefined {
	const invokesLand = argvsOf(command).some(
		(argv) =>
			(/(?:^|\/)fleet$/.test(argv[0] ?? "") && argv[1] === "land" && !argv.includes("--help")) ||
			(/(?:^|\/)sh$/.test(argv[0] ?? "") &&
				argv.includes("--") &&
				argv.some((part, i) => part === "fleet" && argv[i + 1] === "land")),
	);
	if (!invokesLand) return undefined;
	const match = BARE.exec(untrimmed(command));
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
				? "import and push, signing per profile"
				: signs
					? "import and sign"
					: "import, signing per profile";
	if (holdsStandingWord(standing, sandbox))
		return {
			decision: "allow",
			reason: `The Host autonomy section of the overlay holds the person's standing word to land ${sandbox}.`,
			sandbox,
			action,
		};
	return {
		decision: "ask",
		reason: `Ask the person before the ${action} for ${sandbox}.`,
		sandbox,
		action,
	};
}

function holdsStandingWord(standing: (sandbox: string) => boolean, sandbox: string): boolean {
	try {
		return standing(sandbox);
	} catch {
		return false;
	}
}

const HOST_AUTONOMY = /^## Host autonomy$/m;

function originName(repo: string): string {
	try {
		return repoName(execFileSync("git", ["-C", repo, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
	} catch {
		return "";
	}
}

export function sandboxLandStanding(sandbox: string, home = homedir(), list?: SandboxList): boolean {
	const target = sandboxRepositories(sandbox, home, list);
	if (!target) return false;
	const io = realIo(home);
	return target.repos.every((repo) => {
		const name = originName(repo);
		return name !== "" && HOST_AUTONOMY.test(projectOverlay(name, io) ?? "");
	});
}
