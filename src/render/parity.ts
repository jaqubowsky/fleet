import type { Io } from "../fleet/io.ts";
import { HARNESSES, type HarnessName } from "../harness.ts";
import { render, type Seat, seatTokens } from "./render.ts";

export type Divergence = { where: RegExp; reason: string };

const DIVERGENCES: Divergence[] = [
	{ where: /^agents\/[a-z]+\.md: (tools|model|thinking|thinking-level|effort|systemPromptMode|inheritProjectContext|inheritSkills|completionGuard|spawns):/, reason: "each harness has its own subagent frontmatter, tool names and model aliases" },
	{ where: /^agents\/reviewer\.md: You review one diff/, reason: "pi and omp write review.md from the subagent's output, claude's calling session writes it" },
	{ where: /^rules\/delegation\.md: 1\. "Parallel" =/, reason: "each harness starts parallel subagents with its own primitive" },
	{ where: /^rules\/host\.md: 3\. `<cli> steer` on the user's word\./, reason: "pi and omp extensions wake the host session, claude hears a wake only through `cfleet watch` under Monitor" },
	{ where: /^skills\/host\/orchestrating-agent-sessions\/SKILL\.md: \| send it this \|/, reason: "pi and omp take a steer after the current tool call, claude as its next message" },
	{ where: /^skills\/host\/orchestrating-agent-sessions\/SKILL\.md: \| switch models for new containers \|/, reason: "claude's image carries the models, pi and omp read the rendered files" },
	{ where: /^skills\/host\/orchestrating-agent-sessions\/SKILL\.md: (Only the <agent> session that ran|Nothing watches a container by itself here|A watched container working on without settling|- A <cli> wake is a follow-up turn|- A container stopped by a model or network error|A settling agent whose|`<cli> ls` shows the same facts)/, reason: "claude has no extension that can start a turn, so its watching is a held `cfleet watch`" },
	{ where: /^skills\/host\/orchestrating-agent-sessions\/SKILL\.md: \| approve \|/, reason: "claude's `/clear` takes no text, so the continue is a second steer" },
	{ where: /^skills\/container\/two-axis-review\/SKILL\.md: One (foreground `Agent`|`reviewer`) call/, reason: "each harness calls the reviewer and waits for it its own way" },
	{ where: /^skills\/container\/babysit-pr\/SKILL\.md: (Run it as one `Bash` call|<agent> has no background shell)/, reason: "claude waits on CI in a background shell that wakes it, pi and omp have none and poll one read per tool call" },
	{ where: /^claude\/CLAUDE\.md: \(absent\)/, reason: "claude reads CLAUDE.md, which points at rules/; pi and omp read AGENTS.md" },
];

export const VOCABULARY: [string, string][] = [
	["cli", "each harness names its own fleet command"],
	["harness", "each harness names itself"],
	["cache", "each harness keeps its build cache under its own home"],
	["root", "the harness checkout sits at a different path per machine"],
	["tool.ask", "each harness names its question tool"],
	["skill.ingest", "pi and omp prefix a skill command with /skill:, claude does not"],
	["refs", "pi and omp read refs beside AGENTS.md, claude under ~/.claude/refs"],
	["refs.testing", "pi and omp read refs beside AGENTS.md, claude under ~/.claude/refs"],
	["refs.ci", "pi and omp read refs beside AGENTS.md, claude under ~/.claude/refs"],
	["refs.ticket", "pi and omp read refs beside AGENTS.md, claude under ~/.claude/refs"],
	["model.flag", "each harness spells a model in its own syntax"],
	["handoff.command", "each harness clears a session with its own command; what that command takes is compared in the approve row"],
];
const FRAGMENT = /^(?:([a-z]+)\/)?fragments\/(.+)$/;

function normalise(text: string): string {
	return text
		.replace(/~?(\/home\/agent)?\/\.(pi|omp|claude)\b/g, "<home>")
		.replace(/\b[oc]?fleet\b/g, "<cli>")
		.replace(/\b(PI|OMP|CLAUDE)_/g, "<AGENT>_")
		.replace(/\b(pi|omp|claude|Pi|OMP|Claude)\b/g, "<agent>");
}

function rendered(root: string, name: HarnessName, seat: Seat, io: Io): Map<string, string> {
	const harness = HARNESSES[name];
	const seen = new Map<string, string>();
	const quiet: Io = { ...io, harness, write() {}, copy() {}, mkdir() {}, remove() {}, log() {} };
	const placeholders = [...VOCABULARY.map(([key]) => key), ...Object.keys(seatTokens(io, root, harness))];
	render({ root, harness, seat, out: `${io.tmp}/parity`, placeholders, seen }, quiet);
	return new Map([...seen].map(([path, text]) => [path, normalise(text)]));
}

export type Parity = { unlisted: string[]; listed: Map<Divergence, number>; overrides: string[] };

export function parity(root: string, io: Io): Parity {
	const names = Object.keys(HARNESSES) as HarnessName[];
	const result: Parity = { unlisted: [], listed: new Map(DIVERGENCES.map((d) => [d, 0])), overrides: [] };
	const found = new Map<string, Set<HarnessName>>();
	const fragments = new Map<string, Map<string, string>>();
	for (const seat of ["host", "container"] as Seat[]) {
		const texts = new Map(names.map((name) => [name, rendered(root, name, seat, io)]));
		const units = new Set<string>();
		for (const map of texts.values())
			for (const [path, text] of map) {
				const fragment = path.match(FRAGMENT);
				if (fragment) fragments.set(fragment[2], new Map([...(fragments.get(fragment[2]) ?? []), [path, text]]));
				else units.add(path);
			}
		for (const unit of units) {
			const lines = new Map(names.map((name) => [name, new Set(texts.get(name)?.get(unit)?.split("\n"))]));
			for (const name of names) {
				if (!texts.get(name)?.has(unit)) {
					const key = `${unit}: (absent)`;
					found.set(key, new Set([...(found.get(key) ?? []), name]));
					continue;
				}
				for (const line of lines.get(name) ?? []) {
					if (names.every((other) => !texts.get(other)?.has(unit) || lines.get(other)?.has(line))) continue;
					const key = `${unit}: ${line}`;
					found.set(key, new Set([...(found.get(key) ?? []), name]));
				}
			}
		}
	}
	for (const [key, owners] of found) {
		const listed = DIVERGENCES.find((d) => d.where.test(key));
		if (listed) result.listed.set(listed, (result.listed.get(listed) ?? 0) + 1);
		else result.unlisted.push(`${key.length > 160 ? `${key.slice(0, 157)}...` : key} [${[...owners].join(", ")}]`);
	}
	for (const [name, sources] of fragments)
		for (const [path, text] of sources) {
			if (!path.match(FRAGMENT)?.[1]) continue;
			const twin = [...sources].find(([other, body]) => other !== path && body === text);
			if (twin) result.overrides.push(`${path} matches ${twin[0]} up to vocabulary (${name})`);
		}
	return result;
}

export function parityReport(result: Parity): string[] {
	return [
		...result.unlisted.map((line) => `unlisted  ${line}`),
		...[...result.listed].map(([d, lines]) => `listed    ${lines} lines: ${d.reason}`),
		...result.overrides.map((line) => `override  ${line}`),
	];
}
