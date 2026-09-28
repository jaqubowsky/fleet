import { describe, linearServer, loadProfiles, profileFor, repoName, USER_CONFIG, type Host, type Profile } from "../profile/profile.ts";
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

export type PermissionsInput = { root: string; repo: string; apply?: boolean };

export function permissions(input: PermissionsInput, io: Io): string {
	const checkout = io.stat(input.repo)?.dir ? input.repo : undefined;
	if (!checkout && !/^[^/\s]+\/[^/\s]+$/.test(input.repo)) throw new Error(`${input.repo} is neither a checkout nor owner/name`);
	const name = checkout ? repoName(io.git(["remote", "get-url", "origin"], checkout)) : input.repo;
	const profile = repoProfile(input.root, name, io);
	const text = `${describe(name, profile, io.harness.cli)}\n${overlaySection(name, io)}`;
	if (!input.apply) return text;
	if (!checkout) throw new Error(`--apply sets a checkout; give its path, not ${input.repo}`);
	return `${text}\n${apply(checkout, name, profile, io).join("\n")}`;
}

const GH_TOKEN_HELPER = "!gh auth git-credential";

function apply(checkout: string, name: string, profile: Profile, io: Io): string[] {
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
			throw new Error(`origin pushes to ${pushes}, not ${https}: a pushInsteadOf outside this checkout rewrites it, so host.push auto cannot hold here`);
	}
	changes.push(...registerLinear(checkout, profile.host, io));
	return changes.length ? changes : ["nothing changed"];
}

const PROJECT_MCP = {
	pi: { dir: ".pi", entry: (url: string) => ({ url, auth: "oauth" }) },
	omp: { dir: ".omp", entry: (url: string) => ({ type: "http", url }) },
};

type McpConfig = { mcpServers?: Record<string, unknown> };

function registerLinear(checkout: string, host: Host, io: Io): string[] {
	const server = linearServer(host);
	if (!server) return [];
	const [name, url] = server;
	const top = io.git(["rev-parse", "--show-toplevel"], checkout);
	const harness = io.harness.name;
	if (harness === "claude") {
		const projects = (JSON.parse(io.read(`${io.home}/.claude.json`) ?? "{}") as { projects?: Record<string, { mcpServers?: Record<string, { url?: string }> }> }).projects;
		const registered = projects?.[top]?.mcpServers?.[name];
		if (registered?.url === url) return [];
		if (registered) io.run("claude", ["mcp", "remove", "--scope", "local", name], top);
		io.run("claude", ["mcp", "add", "--scope", "local", "--transport", "http", name, url], top);
		return [`host Linear server ${name} registered for ${top} in claude's local scope`];
	}
	const { dir, entry } = PROJECT_MCP[harness];
	const changes: string[] = [];
	const path = `${top}/${dir}/mcp.json`;
	const config = JSON.parse(io.read(path) ?? "{}") as McpConfig;
	if (JSON.stringify(config.mcpServers?.[name]) !== JSON.stringify(entry(url))) {
		io.mkdir(`${top}/${dir}`);
		io.write(path, `${JSON.stringify({ ...config, mcpServers: { ...config.mcpServers, [name]: entry(url) } }, null, 2)}\n`);
		changes.push(`host Linear server ${name} registered in ${path}`);
	}
	const exclude = io.git(["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], top);
	if (!(io.read(exclude) ?? "").split("\n").includes(`/${dir}/`)) {
		io.append(exclude, `/${dir}/`);
		changes.push(`/${dir}/ added to ${exclude}`);
	}
	return changes;
}
