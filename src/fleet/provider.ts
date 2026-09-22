import { buildAgents } from "./agents.ts";
import type { Io } from "./io.ts";

export type Seat = { model: string; thinking: string };

export type Models = { seats: Record<string, Seat> };

function qualified(seat: string, entry: Seat): { provider: string; model: string } {
	const cut = entry.model.indexOf("/");
	if (cut < 1 || cut === entry.model.length - 1) throw new Error(`seat ${seat} needs a provider/model: ${entry.model}`);
	return { provider: entry.model.slice(0, cut), model: entry.model.slice(cut + 1) };
}

export function renderSettings(template: string, models: Models): string {
	const rendered = template.replace(/\{\{(models|thinking|providers)\.([a-z-]+)\}\}/g, (_, field: string, seat: string) => {
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

const SETTINGS: [string, string][] = [
	["profiles/host.json", "agent/settings.json"],
	["profiles/sbx.json", "sbx/agent-settings.json"],
];
const CONTAINER_EXCLUDES = ["host.md"];

export function render(root: string, io: Io): void {
	const models = JSON.parse(io.read(`${root}/profiles/models.json`) ?? "{}") as Models;
	for (const [template, target] of SETTINGS) {
		io.write(`${root}/${target}`, renderSettings(io.read(`${root}/${template}`) ?? "", models));
		io.log(target);
	}
	const rules = io.list(`${root}/rules`).filter((f) => f.endsWith(".md")).sort().map((name) => ({ name, body: io.read(`${root}/rules/${name}`) ?? "" }));
	const refs = io.list(`${root}/rules/refs`).filter((f) => f.endsWith(".md")).sort();
	if (refs.length) io.mkdir(`${root}/agent/refs`);
	for (const name of refs) io.write(`${root}/agent/refs/${name}`, io.read(`${root}/rules/refs/${name}`) ?? "");
	const container = [...rules, { name: "sandbox.md", body: io.read(`${root}/sbx/container/sandbox.md`) ?? "" }];
	for (const [target, sources, exclude] of [["agent/AGENTS.md", rules, []], ["sbx/AGENTS.md", container, CONTAINER_EXCLUDES]] as const) {
		const text = buildAgents([...sources], [...exclude]);
		io.write(`${root}/${target}`, text);
		io.log(`${target}: ${text.split("\n").length} lines`);
	}
}
