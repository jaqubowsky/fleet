import { buildAgents } from "./agents.ts";
import type { Io } from "./io.ts";

export type Models = {
	activeProvider: string;
	providers: Record<string, Record<string, unknown>>;
};

export function roles(models: Models, provider = models.activeProvider): Record<string, string> {
	const row = models.providers[provider];
	if (!row) throw new Error(`unknown provider: ${provider}`);
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(row)) {
		if (typeof value === "string") out[key] = value;
	}
	return out;
}

export function renderSettings(template: string, models: Models): string {
	const provider = models.activeProvider;
	const map = roles(models);
	const rendered = template
		.replaceAll("{{provider}}", provider)
		.replace(/\{\{models\.([a-z-]+)\}\}/g, (_, role: string) => {
			const model = map[role];
			if (!model) throw new Error(`no ${provider} model for role ${role}`);
			return model;
		});
	const left = rendered.match(/\{\{[^}]+\}\}/);
	if (left) throw new Error(`unresolved token: ${left[0]}`);
	JSON.parse(rendered);
	return rendered;
}

export function withActiveProvider(models: Models, provider: string): Models {
	if (!models.providers[provider]) throw new Error(`unknown provider: ${provider}`);
	return { ...models, activeProvider: provider };
}

const SETTINGS: [string, string][] = [
	["profiles/host.json", "agent/settings.json"],
	["profiles/sbx.json", "sbx/agent-settings.json"],
];
const CONTAINER_EXCLUDES = ["delegation.md", "env.md"];

export function render(root: string, io: Io, provider?: string): void {
	const path = `${root}/profiles/models.json`;
	let models = JSON.parse(io.read(path) ?? "{}") as Models;
	if (provider) {
		models = withActiveProvider(models, provider);
		io.write(path, `${JSON.stringify(models, null, 2)}\n`);
	}
	for (const [template, target] of SETTINGS) {
		io.write(`${root}/${target}`, renderSettings(io.read(`${root}/${template}`) ?? "", models));
		io.log(`${target} <- ${models.activeProvider}`);
	}
	const rules = io.list(`${root}/rules`).filter((f) => f.endsWith(".md")).sort().map((name) => ({ name, body: io.read(`${root}/rules/${name}`) ?? "" }));
	const refs = io.list(`${root}/rules/refs`).filter((f) => f.endsWith(".md")).sort();
	if (refs.length) io.mkdir(`${root}/agent/refs`);
	for (const name of refs) io.write(`${root}/agent/refs/${name}`, io.read(`${root}/rules/refs/${name}`) ?? "");
	const container = [...rules, { name: "sandbox.md", body: io.read(`${root}/sbx/container/sandbox.md`) ?? "" }];
	for (const [target, sources, exclude] of [["agent/AGENTS.md", rules, []], ["sbx/AGENTS.md", container, CONTAINER_EXCLUDES]] as const) {
		const text = buildAgents([...sources], [...exclude], io.read);
		io.write(`${root}/${target}`, text);
		io.log(`${target}: ${text.split("\n").length} lines`);
	}
}
