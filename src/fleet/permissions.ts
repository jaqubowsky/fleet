import {
	describe,
	linearServer,
	loadProfiles,
	profileFor,
	repoName,
	USER_CONFIG,
	type Host,
	type Profile,
} from "../profile/profile.ts";
import type { Io } from "./io.ts";

export function repoProfile(root: string, name: string, io: Io): Profile {
	return profileFor(loadProfiles(io.read, root, io.home), name);
}

function overlayPath(name: string): string {
	return `~/${USER_CONFIG}/projects/${name}.md`;
}

export function projectOverlay(name: string, io: Io): string | undefined {
	return io.read(`${io.home}/${USER_CONFIG}/projects/${name}.md`);
}

function overlaySection(name: string, io: Io): string {
	const overlay = projectOverlay(name, io);
	return overlay === undefined
		? `No overlay: ${overlayPath(name)} does not exist`
		: `Overlay ${overlayPath(name)}, which containers read as project.md:\n\n${overlay}`;
}

export type PermissionsInput = { root: string; repo: string; apply?: boolean; brief?: boolean };

export function permissions(input: PermissionsInput, io: Io): string {
	if (input.brief) {
		let name: string;
		try {
			name = repoName(io.git(["remote", "get-url", "origin"], input.repo));
		} catch {
			return "";
		}
		if (!name) return "";
		return apply(input.repo, name, repoProfile(input.root, name, io), io).join("\n");
	}
	const checkout = io.stat(input.repo)?.dir ? input.repo : undefined;
	if (!checkout && !/^[^/\s]+\/[^/\s]+$/.test(input.repo))
		throw new Error(`${input.repo} is neither a checkout nor owner/name`);
	const name = checkout
		? repoName(io.git(["remote", "get-url", "origin"], checkout))
		: input.repo;
	const profile = repoProfile(input.root, name, io);
	const text = `${describe(name, profile)}\n${overlaySection(name, io)}`;
	if (!input.apply) return text;
	if (!checkout)
		throw new Error(`--apply sets a checkout; give its path, not ${input.repo}`);
	const changes = apply(checkout, name, profile, io);
	return `${text}\n${changes.length ? changes.join("\n") : "nothing changed"}`;
}

const GH_TOKEN_HELPER = "!gh auth git-credential";

function apply(
	checkout: string,
	name: string,
	profile: Profile,
	io: Io,
): string[] {
	const changes: string[] = [];
	const local = (key: string): string => {
		try {
			return io.git(["config", "--local", "--get", key], checkout);
		} catch {
			return "unset";
		}
	};
	const sign = profile.host.sign === "none" ? "false" : "true";
	const signing = local("commit.gpgsign");
	if (signing !== sign) {
		io.git(["config", "--local", "commit.gpgsign", sign], checkout);
		changes.push(`commit.gpgsign ${signing} -> ${sign}`);
	}
	if (profile.host.push === "auto") {
		const origin = io.git(["remote", "get-url", "origin"], checkout);
		const https = `https://github.com/${name}.git`;
		if (origin !== https) {
			io.git(["remote", "set-url", "origin", https], checkout);
			changes.push(`origin ${origin} -> ${https}`);
		}
		const pin = `url.${https}.insteadOf`;
		const pinned = local(pin);
		if (pinned !== https) {
			io.git(["config", "--local", "--replace-all", pin, https], checkout);
			changes.push(`${pin} ${pinned} -> ${https}`);
		}
		const helper = "credential.https://github.com.helper";
		const helping = local(helper);
		if (helping !== GH_TOKEN_HELPER) {
			io.git(["config", "--local", "--replace-all", helper, ""], checkout);
			io.git(["config", "--local", "--add", helper, GH_TOKEN_HELPER], checkout);
			changes.push(`${helper} ${helping} -> ${GH_TOKEN_HELPER}`);
		}
		const autoSetup = "branch.autoSetupMerge";
		const tracking = local(autoSetup);
		if (tracking !== "false") {
			io.git(["config", "--local", autoSetup, "false"], checkout);
			changes.push(`${autoSetup} ${tracking} -> false`);
		}
		const pushes = io.git(["remote", "get-url", "--push", "origin"], checkout);
		if (pushes !== https)
			throw new Error(
				`origin pushes to ${pushes}, not ${https}: a pushInsteadOf outside this checkout rewrites it, so host.push auto cannot hold here`,
			);
	}
	changes.push(...registerLinear(checkout, profile.host, io));
	return changes;
}

type McpConfig = { mcpServers?: Record<string, unknown> };

function parseJson<T>(text: string, path: string): T {
	try {
		return JSON.parse(text) as T;
	} catch (cause) {
		throw new Error(`${path}: invalid JSON`, { cause });
	}
}

function registerLinear(checkout: string, host: Host, io: Io): string[] {
	const server = linearServer(host);
	if (!server) return [];
	const [name, url] = server;
	const top = io.git(["rev-parse", "--show-toplevel"], checkout);
	const changes: string[] = [];
	const claudeConfig = `${io.home}/.claude.json`;
	const projects = parseJson<{
		projects?: Record<string, { mcpServers?: Record<string, { url?: string }> }>;
	}>(io.read(claudeConfig) ?? "{}", claudeConfig).projects;
	const registered = projects?.[top]?.mcpServers?.[name];
	if (registered?.url !== url) {
		if (registered)
			io.run("claude", ["mcp", "remove", "--scope", "local", name], top);
		io.run(
			"claude",
			["mcp", "add", "--scope", "local", "--transport", "http", name, url],
			top,
		);
		changes.push(
			`host Linear server ${name} registered for ${top} in claude's local scope`,
		);
	}
	const path = `${top}/.pi/mcp.json`;
	const config = parseJson<McpConfig>(io.read(path) ?? "{}", path);
	const entry = { url, auth: "oauth" };
	if (JSON.stringify(config.mcpServers?.[name]) !== JSON.stringify(entry)) {
		io.mkdir(`${top}/.pi`);
		io.write(
			path,
			`${JSON.stringify({ ...config, mcpServers: { ...config.mcpServers, [name]: entry } }, null, 2)}\n`,
		);
		changes.push(`host Linear server ${name} registered in ${path}`);
	}
	const exclude = io.git(
		["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"],
		top,
	);
	const excluded = io.read(exclude) ?? "";
	if (!excluded.split("\n").includes("/.pi/")) {
		if (excluded && !excluded.endsWith("\n")) io.append(exclude, "");
		io.append(exclude, "/.pi/");
		changes.push(`/.pi/ added to ${exclude}`);
	}
	return changes;
}
