import type { Io } from "../fleet/io.ts";
import type { Harness, HarnessName } from "../harness.ts";
import { hostLinearServers, parseProfiles, PROFILES } from "../profile/profile.ts";

export type Seat = "host" | "container";
export type SeatModel = { model: string; thinking: string };
export type Models = { seats: Record<string, SeatModel> };
export type Source = { name: string; body: string };

const HOST_ONLY_RULES = ["host.md"];
const HOST_LINE = "{{seat.host}} ";
const SKILL_SCOPES: Record<Seat, string[]> = { host: ["shared", "host"], container: ["shared", "container"] };
const AGENTS = ["explorer", "researcher", "reviewer"];

function qualified(seat: string, entry: SeatModel): { provider: string; model: string } {
	const cut = entry.model.indexOf("/");
	if (cut < 1 || cut === entry.model.length - 1) throw new Error(`seat ${seat} needs a provider/model: ${entry.model}`);
	return { provider: entry.model.slice(0, cut), model: entry.model.slice(cut + 1) };
}

export function renderSettings(template: string, models: Models, paths: Record<string, string> = {}): string {
	const rendered = template
		.replace(/\{\{(root|home)\}\}/g, (all, key: string) => paths[key] ?? all)
		.replace(/\{\{(models|thinking|providers)\.([a-z-]+)\}\}/g, (_, field: string, seat: string) => {
			const entry = models.seats?.[seat];
			if (!entry) throw new Error(`no entry for seat ${seat}`);
			if (field === "thinking") return entry.thinking;
			const parts = qualified(seat, entry);
			return field === "models" ? parts.model : parts.provider;
		});
	const left = rendered.match(/\{\{[^}]+\}\}/);
	if (left) throw new Error(`unresolved token: ${left[0]}`);
	JSON.parse(rendered);
	return rendered;
}

export function renderText(text: string, tokens: Record<string, string>, fragment: (name: string) => string | undefined, where: string): string {
	return text.replace(/\{\{(file:)?([a-z][a-z0-9.-]*)\}\}/g, (all, file: string | undefined, key: string) => {
		const value = file ? fragment(key)?.replace(/\n$/, "") : tokens[key];
		if (value === undefined) throw new Error(`${where}: unresolved token ${all}`);
		return value;
	});
}

export function buildAgents(sources: Source[], exclude: string[]): string {
	return sources
		.filter((s) => !exclude.includes(s.name))
		.map((s) => `${s.body.trimEnd()}\n`)
		.join("\n");
}

export function seatSettings(io: Io, root: string, harness: Harness, template: string): string {
	const own = `${root}/${harness.name}/profiles`;
	const models = JSON.parse(io.read(`${own}/models.json`) ?? "{}") as Models;
	const paths = { root, home: `${io.home}/${harness.home}` };
	const base = JSON.parse(renderSettings(io.read(`${own}/settings.json`) ?? "{}", models, paths));
	const seat = JSON.parse(renderSettings(io.read(`${own}/${template}`) ?? "{}", models, paths));
	return `${JSON.stringify({ ...base, ...seat }, null, 2)}\n`;
}

export function seatTokens(io: Io, root: string, harness: Harness): Record<string, string> {
	const models = JSON.parse(io.read(`${root}/${harness.name}/profiles/models.json`) ?? "{}") as Models;
	const tokens: Record<string, string> = {};
	for (const [seat, entry] of Object.entries(models.seats ?? {})) {
		const parts = qualified(seat, entry);
		tokens[`providers.${seat}`] = parts.provider;
		tokens[`models.${seat}`] = parts.model;
		tokens[`thinking.${seat}`] = entry.thinking;
	}
	return tokens;
}

export type RenderInput = { root: string; harness: Harness; seat: Seat; out: string; placeholders?: string[]; seen?: Map<string, string> };

class Renderer {
	readonly input: RenderInput;
	readonly io: Io;

	readonly seats: Record<string, string>;

	constructor(input: RenderInput, io: Io) {
		this.input = input;
		this.io = io;
		this.seats = seatTokens(io, input.root, input.harness);
	}

	get own(): string {
		return `${this.input.root}/${this.input.harness.name}`;
	}

	source(path: string): string {
		const body = this.io.read(`${this.input.root}/${path}`);
		if (body === undefined) throw new Error(`missing ${this.input.root}/${path}`);
		return body;
	}

	text(path: string): string {
		const { root, harness } = this.input;
		const body = this.source(path);
		const tokens: Record<string, string> = { ...harness.tokens, cli: harness.cli, harness: harness.name, cache: `~/${harness.home}/${harness.cache}/<repo>`, ...this.seats, root };
		for (const key of this.input.placeholders ?? []) tokens[key] = `<${key}>`;
		const fragment = (name: string) => {
			const where = [`${this.own}/fragments/${name}.md`, `${root}/fragments/${name}.md`].find((file) => this.io.read(file) !== undefined);
			if (where === undefined) return undefined;
			const text = renderText(this.io.read(where) ?? "", tokens, () => undefined, where);
			this.input.seen?.set(where.slice(root.length + 1), text);
			return text;
		};
		const text = renderText(this.seated(body), tokens, fragment, path);
		this.input.seen?.set(path, text);
		return text;
	}

	seated(body: string): string {
		return body
			.split("\n")
			.flatMap((line) => (line.startsWith(HOST_LINE) ? (this.input.seat === "host" ? [line.slice(HOST_LINE.length)] : []) : [line]))
			.join("\n");
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
			else if (name.endsWith(".md")) this.put(`${to}/${name}`, this.text(`${from}/${name}`));
			else {
				this.io.mkdir(`${this.input.out}/${to}`);
				this.io.copy(`${this.input.root}/${from}/${name}`, `${this.input.out}/${to}/${name}`);
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
		return this.io.list(`${this.input.root}/rules/refs`).filter((f) => f.endsWith(".md")).sort();
	}

	sandboxRule(): Source {
		return { name: "sandbox.md", body: this.text("sbx/container/sandbox.md") };
	}

	skills(flat: boolean, to: string): void {
		for (const scope of SKILL_SCOPES[this.input.seat]) {
			for (const skill of this.io.list(`${this.input.root}/skills/${scope}`).sort()) {
				if (skill === ".DS_Store") continue;
				this.tree(`skills/${scope}/${skill}`, flat ? `${to}/${skill}` : `${to}/${scope}/${skill}`);
			}
		}
	}

	agents(to: string): void {
		for (const name of AGENTS) this.put(`${to}/${name}.md`, this.text(`agents/${name}.md`));
	}

	settings(template: string): string {
		return seatSettings(this.io, this.input.root, this.input.harness, template);
	}

	context(): void {
		const dockerfile = `${this.input.harness.name}/sbx/Dockerfile`;
		const toolchain = this.source("sbx/container/toolchain.Dockerfile").trimEnd();
		this.put("context/Dockerfile", renderText(this.source(dockerfile), { toolchain }, () => undefined, dockerfile));
		this.extra([
			["sbx/container/.dockerignore", "context/.dockerignore"],
			["sbx/container/base-worktree.sh", "context/container/base-worktree.sh"],
			["sbx/container/ticket-check.sh", "context/container/ticket-check.sh"],
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

const MCP_SERVER: Partial<Record<HarnessName, (url: string) => Record<string, string>>> = {
	pi: (url) => ({ url, auth: "oauth" }),
	omp: (url) => ({ type: "http", url }),
};

function hostSettings(r: Renderer, servers: Record<string, string>): string {
	const settings = r.settings("host.json");
	if (r.input.harness.name !== "pi" || !Object.keys(servers).length) return settings;
	const { packages = [] } = JSON.parse(r.settings("sbx.json")) as { packages?: string[] };
	const own = JSON.parse(settings) as { packages?: string[] };
	return `${JSON.stringify({ ...own, packages: [...(own.packages ?? []), ...packages.filter((p) => p.startsWith("npm:pi-mcp-adapter@"))] }, null, 2)}\n`;
}

function hostMcp(r: Renderer, servers: Record<string, string>): void {
	if (!Object.keys(servers).length) return;
	const shape = MCP_SERVER[r.input.harness.name]!;
	const config = JSON.parse(r.io.read(`${r.input.out}/agent/mcp.json`) ?? "{}") as { mcpServers?: Record<string, unknown> };
	const mcpServers = { ...config.mcpServers, ...Object.fromEntries(Object.entries(servers).map(([name, url]) => [name, shape(url)])) };
	r.put("agent/mcp.json", `${JSON.stringify({ ...config, mcpServers }, null, 2)}\n`);
}

function piFamily(r: Renderer, settingsFile: string, containerSettingsFile: string, agentFiles: [string, string][], containerFiles: [string, string][]): void {
	const { seat } = r.input;
	const rules = r.rules();
	if (seat === "host") {
		const servers = hostLinearServers(parseProfiles(r.source(PROFILES)));
		r.put(`agent/${settingsFile}`, hostSettings(r, servers));
		hostMcp(r, servers);
		r.put("agent/AGENTS.md", buildAgents(rules, []));
		for (const name of r.refs()) r.put(`agent/refs/${name}`, r.text(`rules/refs/${name}`));
		r.agents("agent/agents");
		r.skills(false, "skills");
		r.extra(agentFiles.map(([from, to]): [string, string] => [from, `agent/${to}`]));
		return;
	}
	r.context();
	r.put(`context/${containerSettingsFile}`, r.settings("sbx.json"));
	r.put("home/agent/AGENTS.md", buildAgents([...rules, r.sandboxRule()], HOST_ONLY_RULES));
	for (const name of r.refs()) r.put(`home/agent/refs/${name}`, r.text(`rules/refs/${name}`));
	r.agents("home/agent/agents");
	r.skills(true, "home/skills");
	r.extra([
		...agentFiles.map(([from, to]): [string, string] => [from, `home/agent/${to}`]),
		["extensions/handoff-on-error.ts", "home/agent/extensions/handoff-on-error.ts"],
		["extensions/status-history.ts", "home/agent/extensions/status-history.ts"],
		["extensions/state-relay.ts", "home/agent/extensions/state-relay.ts"],
		["extensions/session-handoff.ts", "context/extensions/session-handoff.ts"],
		["extensions/status-history.ts", "context/extensions/status-history.ts"],
		["extensions/container-guard.ts", "home/agent/extensions/container-guard.ts"],
		["src/guard/container.ts", "home/agent/src/guard/container.ts"],
		["src/guard/argv.ts", "home/agent/src/guard/argv.ts"],
		["src/guard/translate.ts", "home/agent/src/guard/translate.ts"],
		...containerFiles,
	]);
}

function claude(r: Renderer): void {
	const { seat } = r.input;
	const rules = r.rules();
	if (seat === "host") {
		for (const rule of rules) r.put(`rules/${rule.name}`, rule.body);
		for (const name of r.refs()) r.put(`refs/${name}`, r.text(`rules/refs/${name}`));
		r.agents("agents");
		r.skills(true, "skills");
		r.put("CLAUDE.md", r.text("claude/CLAUDE.md"));
		return;
	}
	for (const rule of [...rules, r.sandboxRule()].filter((x) => !HOST_ONLY_RULES.includes(x.name))) r.put(`home/rules/${rule.name}`, rule.body);
	for (const name of r.refs()) r.put(`home/refs/${name}`, r.text(`rules/refs/${name}`));
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
		["src/fleet/usage.ts", "home/fleet/src/fleet/usage.ts"],
		["extensions/handoff-on-error.ts", "home/fleet/extensions/handoff-on-error.ts"],
		["extensions/status-history.ts", "home/fleet/extensions/status-history.ts"],
		["extensions/session-handoff.ts", "home/fleet/extensions/session-handoff.ts"],
	]);
}

export const OWNED: Record<HarnessName, string[]> = {
	pi: ["skills", "agent/refs", "agent/agents", "agent/themes"],
	omp: ["skills", "agent/refs", "agent/agents", "agent/models.json", "agent/themes"],
	claude: ["rules", "refs", "skills", "agents"],
};

export function render(input: RenderInput, io: Io): void {
	if (input.seat === "host") for (const dir of OWNED[input.harness.name]) io.remove(`${input.out}/${dir}`);
	const r = new Renderer(input, io);
	if (input.harness.name === "pi")
		piFamily(
			r,
			"settings.json",
			"agent-settings.json",
			[
				["pi/models.json", "models.json"],
				["pi/themes/ayu-mirage.json", "themes/ayu-mirage.json"],
			],
			[
				["extensions/statusline.ts", "home/agent/extensions/statusline.ts"],
				["src/statusline/statusline.ts", "home/agent/src/statusline/statusline.ts"],
			],
		);
	else if (input.harness.name === "omp")
		piFamily(
			r,
			"config.yml",
			"agent-config.yml",
			[
				["pi/models.json", "models.yml"],
				["omp/themes/ayu-mirage.json", "themes/ayu-mirage.json"],
			],
			[["omp/sbx/omp-entrypoint", "context/container/omp-entrypoint"]],
		);
	else claude(r);
	io.log(`${input.harness.name} ${input.seat} -> ${input.out}`);
}
