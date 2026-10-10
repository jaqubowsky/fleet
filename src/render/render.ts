import type { Io } from "../fleet/io.ts";
import { type AgentName, CLI, CONTINUE, KINDS } from "../harness.ts";
import { hostLinearServers, loadProfiles } from "../profile/profile.ts";

export type Seat = "host" | "container";
export type SeatModel = { model: string; thinking: string };
export type Models = { seats: Record<string, SeatModel> };
type Source = { name: string; body: string };

const HOST_ONLY_RULES = ["host.md"];
const SKILL_SCOPES: Record<Seat, string[]> = {
	host: ["shared", "host"],
	container: ["shared", "container"],
};
const AGENTS: Record<Seat, string[]> = {
	host: ["explorer", "researcher", "reviewer"],
	container: ["explorer", "researcher", "reviewer"],
};
const OUTCOMES = "orchestrating-agent-sessions/references/outcomes.md";

function qualified(
	seat: string,
	entry: SeatModel,
): { provider: string; model: string } {
	const cut = entry.model.indexOf("/");
	if (cut < 1 || cut === entry.model.length - 1)
		throw new Error(`seat ${seat} needs a provider/model: ${entry.model}`);
	return {
		provider: entry.model.slice(0, cut),
		model: entry.model.slice(cut + 1),
	};
}

function parseJson<T>(text: string): T {
	try {
		return JSON.parse(text) as T;
	} catch (cause) {
		throw new Error("Invalid rendered JSON", { cause });
	}
}

export function renderSettings(
	template: string,
	models: Models,
	paths: Record<string, string> = {},
): string {
	const rendered = template
		.replace(/\{\{(root|home)\}\}/g, (all, key: string) => paths[key] ?? all)
		.replace(
			/\{\{(models|thinking|providers)\.([a-z-]+)\}\}/g,
			(_, field: string, seat: string) => {
				const entry = models.seats?.[seat];
				if (!entry) throw new Error(`no entry for seat ${seat}`);
				if (field === "thinking") return entry.thinking;
				const parts = qualified(seat, entry);
				return field === "models" ? parts.model : parts.provider;
			},
		);
	const left = rendered.match(/\{\{[^}]+\}\}/);
	if (left) throw new Error(`unresolved token: ${left[0]}`);
	parseJson(rendered);
	return rendered;
}

export function renderText(
	text: string,
	tokens: Record<string, string>,
	fragment: (name: string) => string | undefined,
	where: string,
): string {
	return text.replace(
		/\{\{(file:)?([a-z][a-z0-9.-]*)\}\}/g,
		(all, file: string | undefined, key: string) => {
			const value = file ? fragment(key)?.replace(/\n$/, "") : tokens[key];
			if (value === undefined)
				throw new Error(`${where}: unresolved token ${all}`);
			return value;
		},
	);
}

export function buildAgents(sources: Source[], exclude: string[]): string {
	return sources
		.filter((s) => !exclude.includes(s.name))
		.map((s) => `${s.body.trimEnd()}\n`)
		.join("\n");
}

export function seatSettings(
	io: Io,
	root: string,
	agent: AgentName,
	template: string,
): string {
	const own = `${root}/${agent}/profiles`;
	const models = parseJson<Models>(io.read(`${own}/models.json`) ?? "{}");
	const paths = { root, home: `${io.home}/${KINDS[agent].home}` };
	const base = parseJson<Record<string, unknown>>(
		renderSettings(io.read(`${own}/settings.json`) ?? "{}", models, paths),
	);
	const seat = parseJson<Record<string, unknown>>(
		renderSettings(io.read(`${own}/${template}`) ?? "{}", models, paths),
	);
	return `${JSON.stringify({ ...base, ...seat }, null, 2)}\n`;
}

export function seatTokens(
	io: Io,
	root: string,
	agent: AgentName,
): Record<string, string> {
	const models = parseJson<Models>(
		io.read(`${root}/${agent}/profiles/models.json`) ?? "{}",
	);
	const tokens: Record<string, string> = {};
	for (const [seat, entry] of Object.entries(models.seats ?? {})) {
		const parts = qualified(seat, entry);
		tokens[`providers.${seat}`] = parts.provider;
		tokens[`models.${seat}`] = parts.model;
		tokens[`thinking.${seat}`] = entry.thinking;
	}
	return tokens;
}

type RenderInput = {
	root: string;
	agent: AgentName;
	seat: Seat;
	out: string;
	placeholders?: string[];
	seen?: Map<string, string>;
};

class Renderer {
	readonly input: RenderInput;
	readonly io: Io;

	readonly seats: Record<string, string>;

	constructor(input: RenderInput, io: Io) {
		this.input = input;
		this.io = io;
		this.seats = seatTokens(io, input.root, input.agent);
	}

	get own(): string {
		return `${this.input.root}/${this.input.agent}`;
	}

	source(path: string): string {
		const body = this.io.read(`${this.input.root}/${path}`);
		if (body === undefined) throw new Error(`missing ${this.input.root}/${path}`);
		return body;
	}

	text(path: string): string {
		const { root, agent } = this.input;
		const kind = KINDS[agent];
		const body = this.source(path);
		const tokens: Record<string, string> = {
			...kind.tokens,
			cli: CLI,
			continue: CONTINUE,
			...this.seats,
			root,
			wiki: `${this.io.home}/my-knowledge-base`,
		};
		for (const key of this.input.placeholders ?? []) tokens[key] = `<${key}>`;
		const fragment = (name: string) => {
			const where = [
				`${this.own}/fragments/${name}.md`,
				`${root}/fragments/${name}.md`,
			].find((file) => this.io.read(file) !== undefined);
			if (where === undefined) return undefined;
			const text = renderText(
				this.io.read(where) ?? "",
				tokens,
				() => undefined,
				where,
			);
			this.input.seen?.set(where.slice(root.length + 1), text);
			return text;
		};
		const text = renderText(body, tokens, fragment, path);
		this.input.seen?.set(path, text);
		return text;
	}

	put(path: string, body: string): void {
		const target = `${this.input.out}/${path}`;
		this.io.mkdir(target.slice(0, target.lastIndexOf("/")));
		this.io.write(target, body);
	}

	tree(from: string, to: string): void {
		for (const name of this.io.list(`${this.input.root}/${from}`)) {
			if (name === ".DS_Store") continue;
			const info = this.io.stat(`${this.input.root}/${from}/${name}`);
			if (!info) continue;
			if (info.dir) this.tree(`${from}/${name}`, `${to}/${name}`);
			else if (name.endsWith(".md"))
				this.put(`${to}/${name}`, this.text(`${from}/${name}`));
			else {
				this.io.mkdir(`${this.input.out}/${to}`);
				this.io.copy(
					`${this.input.root}/${from}/${name}`,
					`${this.input.out}/${to}/${name}`,
				);
			}
		}
	}

	rules(): Source[] {
		return this.io
			.list(`${this.input.root}/rules`)
			.filter((f) => f.endsWith(".md"))
			.sort()
			.map((name) => ({ name, body: this.text(`rules/${name}`) }));
	}

	refs(): string[] {
		return this.io
			.list(`${this.input.root}/rules/refs`)
			.filter((f) => f.endsWith(".md"))
			.sort();
	}

	sandboxRule(): Source {
		return { name: "sandbox.md", body: this.text("sbx/container/sandbox.md") };
	}

	skills(flat: boolean, to: string): void {
		for (const scope of SKILL_SCOPES[this.input.seat]) {
			for (const skill of this.io
				.list(`${this.input.root}/skills/${scope}`)
				.sort()) {
				if (skill === ".DS_Store") continue;
				this.tree(
					`skills/${scope}/${skill}`,
					flat ? `${to}/${skill}` : `${to}/${scope}/${skill}`,
				);
			}
		}
		if (this.input.seat === "host")
			this.put(flat ? `${to}/${OUTCOMES}` : `${to}/host/${OUTCOMES}`, this.outcomes());
	}

	outcomes(): string {
		const lines = this.io
			.list(`${this.input.root}/skills/container`)
			.sort()
			.flatMap((skill) => {
				const head = this.io.read(
					`${this.input.root}/skills/container/${skill}/SKILL.md`,
				);
				if (head === undefined) return [];
				const [, quoted, plain] =
					head.match(/^description: (?:'(.*)'|(.*))$/m) ?? [];
				return `- ${quoted?.replaceAll("''", "'") ?? plain}`;
			});
		return [
			"<!-- Code generated by src/render/render.ts from each skills/container/*/SKILL.md description. DO NOT EDIT. -->",
			"# What a container can deliver",
			"",
			...lines,
			"",
		].join("\n");
	}

	agents(to: string): void {
		for (const name of AGENTS[this.input.seat])
			this.put(`${to}/${name}.md`, this.text(`agents/${name}.md`));
	}

	settings(template: string): string {
		return seatSettings(this.io, this.input.root, this.input.agent, template);
	}

	context(): void {
		const dockerfile = `${this.input.agent}/sbx/Dockerfile`;
		const toolchain = this.source("sbx/container/toolchain.Dockerfile").trimEnd();
		this.put(
			"context/Dockerfile",
			renderText(
				this.source(dockerfile),
				{ toolchain },
				() => undefined,
				dockerfile,
			),
		);
		this.extra([
			["sbx/container/.dockerignore", "context/.dockerignore"],
			["sbx/container/base-worktree.sh", "context/container/base-worktree.sh"],
			["sbx/container/ci-wait.sh", "context/container/ci-wait.sh"],
		]);
	}

	extra(files: [string, string][]): void {
		for (const [from, to] of files) {
			const source = `${this.input.root}/${from}`;
			if (!this.io.stat(source)) continue;
			this.io.mkdir(`${this.input.out}/${to.slice(0, to.lastIndexOf("/"))}`);
			this.io.copy(source, `${this.input.out}/${to}`);
		}
	}
}

function hostMcp(r: Renderer, servers: Record<string, string>): void {
	const config = parseJson<{ mcpServers?: Record<string, unknown> }>(
		r.io.read(`${r.input.out}/agent/mcp.json`) ?? "{}",
	);
	const present = Object.entries(config.mcpServers ?? {});
	const kept = present.filter(([name]) => !(name in servers));
	if (kept.length === present.length) return;
	r.put(
		"agent/mcp.json",
		`${JSON.stringify({ ...config, mcpServers: Object.fromEntries(kept) }, null, 2)}\n`,
	);
}

const PI_AGENT_FILES: [string, string][] = [
	["pi/models.json", "models.json"],
	["pi/themes/ayu-mirage.json", "themes/ayu-mirage.json"],
];

function pi(r: Renderer): void {
	const { seat } = r.input;
	const rules = r.rules();
	if (seat === "host") {
		const servers = hostLinearServers(
			loadProfiles((path) => r.io.read(path), r.input.root, r.io.home),
		);
		r.put("agent/settings.json", r.settings("host.json"));
		hostMcp(r, servers);
		r.put("agent/AGENTS.md", buildAgents(rules, []));
		for (const name of r.refs())
			r.put(`agent/refs/${name}`, r.text(`rules/refs/${name}`));
		r.agents("agent/agents");
		r.skills(false, "skills");
		r.extra(
			PI_AGENT_FILES.map(([from, to]): [string, string] => [from, `agent/${to}`]),
		);
		return;
	}
	r.context();
	r.put("context/agent-settings.json", r.settings("sbx.json"));
	r.put(
		"home/agent/AGENTS.md",
		buildAgents([...rules, r.sandboxRule()], HOST_ONLY_RULES),
	);
	for (const name of r.refs())
		r.put(`home/agent/refs/${name}`, r.text(`rules/refs/${name}`));
	r.agents("home/agent/agents");
	r.skills(true, "home/skills");
	r.extra([
		...PI_AGENT_FILES.map(([from, to]): [string, string] => [
			from,
			`home/agent/${to}`,
		]),
		["extensions/activity.ts", "home/agent/extensions/activity.ts"],
		["extensions/state-relay.ts", "home/agent/extensions/state-relay.ts"],
		["extensions/container-guard.ts", "home/agent/extensions/container-guard.ts"],
		["src/guard/container.ts", "home/agent/src/guard/container.ts"],
		["src/guard/argv.ts", "home/agent/src/guard/argv.ts"],
		["src/guard/translate.ts", "home/agent/src/guard/translate.ts"],
		["extensions/statusline.ts", "home/agent/extensions/statusline.ts"],
		["src/statusline/statusline.ts", "home/agent/src/statusline/statusline.ts"],
	]);
}

function claude(r: Renderer): void {
	const { seat } = r.input;
	const rules = r.rules();
	if (seat === "host") {
		for (const rule of rules) r.put(`rules/${rule.name}`, rule.body);
		for (const name of r.refs())
			r.put(`refs/${name}`, r.text(`rules/refs/${name}`));
		r.agents("agents");
		r.skills(true, "skills");
		r.put("CLAUDE.md", r.text("claude/CLAUDE.md"));
		return;
	}
	for (const rule of [...rules, r.sandboxRule()].filter(
		(x) => !HOST_ONLY_RULES.includes(x.name),
	))
		r.put(`home/rules/${rule.name}`, rule.body);
	for (const name of r.refs())
		r.put(`home/refs/${name}`, r.text(`rules/refs/${name}`));
	r.agents("home/agents");
	r.skills(true, "home/skills");
	r.put("home/CLAUDE.md", r.text("claude/CLAUDE.md"));
	r.context();
	r.put("context/settings.json", r.settings("sbx.json"));
	r.put("stage.sh", r.source("claude/sbx/stage.sh"));
	r.extra([
		["claude/statusline.mjs", "home/fleet/claude/statusline.mjs"],
		["src/statusline/statusline.ts", "home/fleet/src/statusline/statusline.ts"],
		["claude/hooks/container.ts", "home/fleet/claude/hooks/container.ts"],
		["src/guard/container.ts", "home/fleet/src/guard/container.ts"],
		["src/guard/argv.ts", "home/fleet/src/guard/argv.ts"],
		["extensions/activity.ts", "home/fleet/extensions/activity.ts"],
	]);
}

export const OWNED: Record<AgentName, string[]> = {
	pi: ["skills", "agent/refs", "agent/agents", "agent/themes"],
	claude: ["rules", "refs", "skills", "agents"],
};

export function render(input: RenderInput, io: Io): void {
	if (input.seat === "host")
		for (const dir of OWNED[input.agent]) io.remove(`${input.out}/${dir}`);
	const r = new Renderer(input, io);
	if (input.agent === "pi") pi(r);
	else claude(r);
	io.log(`${input.agent} ${input.seat} -> ${input.out}`);
}
