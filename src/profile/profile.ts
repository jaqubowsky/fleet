type Level = "none" | "human" | "auto";
type LinearLevel = "none" | "read" | "write";
export type Host = { sign: Level; push: Level; pr: Level; merge: Level; down: Level; linear: LinearLevel; linearServer?: string };
type Container = { push: Level; pr: Level; linear: LinearLevel; linearServer?: string; token: string };
type Resources = { memory: string; cpus: string };
export type Profile = { match: string; file: string; host: Host; container: Container; resources: Resources };
type Profiles = Record<string, Profile>;

export const PROFILES = "host/repos.json";
export const USER_CONFIG = ".config/harness";
const USER_PROFILES = `~/${USER_CONFIG}/repos.json`;

const LEVELS = ["none", "human", "auto"];
const LINEAR = ["none", "read", "write"];

type Entry = Record<string, unknown>;

function object(value: unknown, where: string): Entry {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${where} is not an object`);
	return value as Entry;
}

function oneOf(entry: Entry, key: string, allowed: string[], where: string): void {
	if (!allowed.includes(entry[key] as string)) throw new Error(`${where}.${key} is ${JSON.stringify(entry[key])}; it takes ${allowed.join(", ")}`);
}

function exactly(entry: Entry, keys: string[], where: string): void {
	for (const key of Object.keys(entry)) if (!keys.includes(key)) throw new Error(`${where}.${key} is not a field here; the fields are ${keys.join(", ")}`);
	for (const key of keys) if (entry[key] === undefined) throw new Error(`${where}.${key} is missing`);
}

function text(entry: Entry, keys: string[], where: string): void {
	for (const key of keys) if (typeof entry[key] !== "string" || !entry[key]) throw new Error(`${where}.${key} takes a non-empty string`);
}

function seat(value: unknown, levels: string[], texts: string[], where: string): Entry {
	const entry = object(value, where);
	oneOf(entry, "linear", LINEAR, where);
	const named = [...texts, ...(entry.linear === "none" ? [] : ["linearServer"])];
	exactly(entry, [...levels, "linear", ...named], where);
	for (const key of levels) oneOf(entry, key, LEVELS, where);
	text(entry, named, where);
	return entry;
}

function json(text: string, file: string): unknown {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(`${file}: ${(error as Error).message}`);
	}
}

function entries(source: string, file: string): Profiles {
	const profiles: Profiles = {};
	for (const [match, value] of Object.entries(object(json(source, file), file))) {
		const where = `${file} ${match}`;
		if (!/^(\*|[^/\s*]+\/(\*|[^/\s*]+))$/.test(match)) throw new Error(`${where}: a match is owner/repo, owner/* or *`);
		const key = match.toLowerCase();
		if (profiles[key]) throw new Error(`${where} repeats ${profiles[key].match}`);
		const entry = object(value, where);
		exactly(entry, ["host", "container", "resources"], where);
		if (object(entry.container, `${where}.container`).merge !== undefined) throw new Error(`${where}.container.merge: containers never merge`);
		const host = seat(entry.host, ["sign", "push", "pr", "merge", "down"], [], `${where}.host`) as Host;
		const container = seat(entry.container, ["push", "pr"], ["token"], `${where}.container`) as Container;
		const resources = object(entry.resources, `${where}.resources`);
		exactly(resources, ["memory", "cpus"], `${where}.resources`);
		text(resources, ["memory", "cpus"], `${where}.resources`);
		if (host.sign === "human" && container.push === "auto")
			throw new Error(`${where}: host.sign human cannot go with container.push auto; unsigned commits would reach GitHub before signing, and signing them afterwards takes a force push`);
		profiles[key] = { match, file, host, container, resources: resources as Resources };
	}
	return profiles;
}

export function parseProfiles(repo: string, user?: string): Profiles {
	const profiles = { ...entries(repo, PROFILES), ...(user === undefined ? {} : entries(user, USER_PROFILES)) };
	if (!profiles["*"]) throw new Error(`${USER_PROFILES} and ${PROFILES} have no * entry, the profile an unknown repository gets`);
	return profiles;
}

export function loadProfiles(read: (path: string) => string | undefined, root: string, home: string): Profiles {
	const repo = read(`${root}/${PROFILES}`);
	if (repo === undefined) throw new Error(`missing ${root}/${PROFILES}`);
	return parseProfiles(repo, read(`${home}/${USER_CONFIG}/repos.json`));
}

export function repoName(origin: string): string {
	return /github\.com[^:/]*[:/]([^/\s]+\/[^/\s]+?)(\.git)?\/?$/i.exec(origin.trim())?.[1] ?? "";
}

export function profileFor(profiles: Profiles, repo: string): Profile {
	const name = repo.toLowerCase();
	return profiles[name] ?? profiles[`${name.split("/")[0]}/*`] ?? profiles["*"];
}

const LINEAR_URL = { read: "https://mcp.linear.app/mcp/readonly", write: "https://mcp.linear.app/mcp" };

export function hostLinearServer(host: Host): [string, string] | undefined {
	return host.linear !== "none" && host.linearServer ? [host.linearServer, LINEAR_URL[host.linear]] : undefined;
}

export function hostLinearServers(profiles: Profiles): Record<string, string> {
	return Object.fromEntries(Object.values(profiles).flatMap(({ host }) => [hostLinearServer(host)].filter((server) => server !== undefined)));
}

const WRITES = { container: "write only what you were told to", host: "move states, file not-started issues, tick the criteria you saw hold and post the acceptance comment by judgment" };

const linear = (entry: Host | Container, seat: keyof typeof WRITES): string =>
	entry.linear === "none" ? "no Linear server" : `${entry.linear === "read" ? "read" : "read and write"} Linear through \`${entry.linearServer}\`${entry.linear === "read" ? "; nothing can be written there" : `; ${WRITES[seat]}, and say what you posted`}`;

function says(cli: string): Record<string, Record<string, Record<string, string>>> {
	const resync = `then \`${cli} steer <sandbox> "resync and open the PR"\`; the resync comes first because signing rewrote its commits`;
	return {
		container: {
			push: {
				none: "no credential here pushes; the host lands, signs and pushes the branch, and a steer tells you once it is on GitHub",
				human: "prepare the branch and ask for the push under `attention:`; the person pushes it, and a steer tells you once it is on GitHub",
				auto: "push your own branch to origin, never forced and never the default branch, before `ready-for-host` and at the end of each pull request round",
			},
			pr: { none: "no credential here opens a pull request", human: "draft the pull request and ask under `attention:`; the person opens it", auto: "open and update the pull request of your own branch once the branch is on GitHub" },
		},
		host: {
			sign: { none: `commits stay unsigned; \`${cli} land\` signs only with --sign`, human: `\`${cli} land\` signs every commit origin lacks, one Touch ID tap each`, auto: `\`${cli} land\` signs every commit origin lacks, with a key that asks nobody` },
			push: { none: "nothing on the host pushes this repository; the guard refuses `git push`", human: `start the push with \`git push\` or \`${cli} land --push\`; the person confirms it with Touch ID`, auto: `push with \`git push\`, never forced; the guard allows it, and \`${cli} profile --apply\` keeps the origin on HTTPS with no branch tracking` },
			pr: { none: "the host opens no pull request; the guard refuses `gh pr create`", human: "prepare the pull request and hand its command to the person; the guard refuses `gh pr create`", auto: "open the pull request with `gh pr create`; the guard allows it" },
			merge: { none: "the host merges nothing; the guard refuses `gh pr merge`", human: "accept or reject the pull request, then hand the merge to the person; the guard refuses `gh pr merge`", auto: "merge an accepted pull request with `gh pr merge`; the guard allows it" },
			down: { none: `the host takes no container down; the person runs \`${cli} down\`, and nothing refuses it, so this line is the rule`, human: `\`${cli} down <sandbox>\` on the person's word, every time; the task directory stays, and nothing refuses it, so this line is the rule`, auto: `\`${cli} down <sandbox>\` once its pull request is merged; the task directory stays` },
			land: {
				host: `\`${cli} land --sign --push <sandbox>\` puts the container's branch on GitHub, ${resync}`,
				person: `\`${cli} land --sign <sandbox>\` brings the container's branch here and the person pushes it from their own shell, ${resync}`,
				auto: "the container pushes its own branch and opens its pull request; no landing takes them to GitHub",
			},
		},
	};
}

export function describe(repo: string, profile: Profile, cli: string): string {
	const say = says(cli);
	const line = (action: string, level: string, sentence: string) => `- ${action} \`${level}\`: ${sentence}`;
	const { host, container, resources } = profile;
	return [
		`# Permissions: ${repo || "no GitHub origin"}`,
		"",
		`Profile \`${profile.match}\` of \`${profile.file}\`. This file describes; the credentials enforce. Commit is always allowed on both seats.`,
		"",
		"## Container",
		"",
		line("push", container.push, say.container.push[container.push]),
		line("pr", container.pr, say.container.pr[container.pr]),
		line("merge", "none", "containers never merge"),
		line("linear", container.linear, linear(container, "container")),
		`- resources: ${resources.memory} memory, ${resources.cpus} cpus`,
		"",
		"## Host",
		"",
		line("sign", host.sign, say.host.sign[host.sign]),
		line("push", host.push, say.host.push[host.push]),
		line("pr", host.pr, say.host.pr[host.pr]),
		line("merge", host.merge, say.host.merge[host.merge]),
		line("down", host.down, say.host.down[host.down]),
		line("linear", host.linear, linear(host, "host")),
		`- land: ${say.host.land[container.push === "auto" ? "auto" : host.push === "none" ? "person" : "host"]}`,
		"",
	].join("\n");
}
