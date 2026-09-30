import type { Io } from "../fleet/io.ts";
import { type AgentName, KINDS } from "../harness.ts";
import { render, type Seat, seatTokens } from "./render.ts";

export type Divergence = { where: RegExp; reason: string };

const DIVERGENCES: Divergence[] = [
	{
		where: /^rules\/delegation\.md: 1\. "Parallel" =/,
		reason:
			"pi starts runs in the background, claude sends several background `Agent` calls in one message",
	},
	{
		where:
			/^skills\/host\/orchestrating-agent-sessions\/SKILL\.md: (Only the session that ran|Nothing watches a container by itself here)/,
		reason:
			"claude has no extension that can start a turn, so its watching is a held `fleet watch`",
	},
	{
		where:
			/^skills\/host\/orchestrating-agent-sessions\/SKILL\.md: \| send it this \|/,
		reason:
			"a pi seat watches a steered container from its own session, a claude seat through a held `fleet watch`",
	},
	{
		where:
			/^skills\/host\/orchestrating-agent-sessions\/SKILL\.md: \| switch models for new containers \|/,
		reason:
			"claude has no rendered host settings file: its host reads the person's own ~/.claude/settings.json, into which `align-settings.py` merges `claude/profiles/host.json`, where pi `/reload`s a rendered file",
	},
	{
		where:
			/^skills\/container\/two-axis-review\/SKILL\.md: One (foreground `Agent`|`reviewer`) call/,
		reason:
			"claude's `Agent` call has no output file, so the caller writes review.md; pi's subagent call needs `async: false` to wait",
	},
	{
		where:
			/^skills\/container\/babysit-pr\/SKILL\.md: (Run it as one `Bash` call|<agent> has no background shell)/,
		reason:
			"pi has no background shell that wakes the session, so it polls one read per tool call",
	},
];

export const VOCABULARY: [string, string][] = [
	["cli", "each harness names its own fleet command"],
	["root", "the harness checkout sits at a different path per machine"],
	["tool.ask", "each harness names its question tool"],
	["skill.ingest", "pi prefixes a skill command with /skill:, claude does not"],
	["refs", "pi reads refs beside AGENTS.md, claude under ~/.claude/refs"],
	["refs.ci", "pi reads refs beside AGENTS.md, claude under ~/.claude/refs"],
	["refs.ticket", "pi reads refs beside AGENTS.md, claude under ~/.claude/refs"],
	["handoff.command", "each kind clears a session with its own command"],
];
const FRAGMENT = /^(?:([a-z]+)\/)?fragments\/(.+)$/;

function normalise(text: string): string {
	return text
		.replace(/~?(\/home\/agent)?\/\.(pi|claude)\b/g, "<home>")
		.replace(/\bfleet\b/g, "<cli>")
		.replace(/\b(PI|CLAUDE)_/g, "<AGENT>_")
		.replace(/\b(pi|claude|Pi|Claude)\b/g, "<agent>");
}

function rendered(
	root: string,
	name: AgentName,
	seat: Seat,
	io: Io,
): Map<string, string> {
	const seen = new Map<string, string>();
	const quiet: Io = {
		...io,
		write() {},
		copy() {},
		mkdir() {},
		remove() {},
		log() {},
	};
	const placeholders = [
		...VOCABULARY.map(([key]) => key),
		...Object.keys(seatTokens(io, root, name)),
	];
	render(
		{ root, agent: name, seat, out: `${io.tmp}/parity`, placeholders, seen },
		quiet,
	);
	return new Map([...seen].map(([path, text]) => [path, normalise(text)]));
}

export type Parity = {
	unlisted: string[];
	listed: Map<Divergence, number>;
	overrides: string[];
	own: Map<string, number>;
};

export function parity(root: string, io: Io): Parity {
	const names = Object.keys(KINDS) as AgentName[];
	const result: Parity = {
		unlisted: [],
		listed: new Map(DIVERGENCES.map((d) => [d, 0])),
		overrides: [],
		own: new Map(),
	};
	const found = new Map<string, Set<AgentName>>();
	const fragments = new Map<string, Map<string, string>>();
	for (const seat of ["host", "container"] as Seat[]) {
		const texts = new Map(
			names.map((name) => [name, rendered(root, name, seat, io)]),
		);
		const units = new Set<string>();
		for (const map of texts.values())
			for (const [path, text] of map) {
				const fragment = path.match(FRAGMENT);
				if (fragment)
					fragments.set(
						fragment[2],
						new Map([...(fragments.get(fragment[2]) ?? []), [path, text]]),
					);
				else units.add(path);
			}
		const own = new Map(names.map((name) => [name, new Set<string>()]));
		for (const [name, sources] of fragments) {
			if (io.read(`${root}/fragments/${name}`) !== undefined) continue;
			for (const [path, text] of sources) {
				const harness = path.match(FRAGMENT)?.[1] as AgentName;
				for (const line of text.split("\n")) own.get(harness)?.add(line);
				result.own.set(path, text.split("\n").length);
			}
		}
		for (const unit of units) {
			if (names.some((name) => unit.startsWith(`${name}/`))) continue;
			const lines = new Map(
				names.map((name) => [
					name,
					new Set(texts.get(name)?.get(unit)?.split("\n")),
				]),
			);
			for (const name of names) {
				if (!texts.get(name)?.has(unit)) {
					const key = `${unit}: (absent)`;
					found.set(key, new Set([...(found.get(key) ?? []), name]));
					continue;
				}
				for (const line of lines.get(name) ?? []) {
					if (own.get(name)?.has(line)) continue;
					if (
						names.every(
							(other) => !texts.get(other)?.has(unit) || lines.get(other)?.has(line),
						)
					)
						continue;
					const key = `${unit}: ${line}`;
					found.set(key, new Set([...(found.get(key) ?? []), name]));
				}
			}
		}
	}
	for (const [key, owners] of found) {
		const listed = DIVERGENCES.find((d) => d.where.test(key));
		if (listed) result.listed.set(listed, (result.listed.get(listed) ?? 0) + 1);
		else
			result.unlisted.push(
				`${key.length > 160 ? `${key.slice(0, 157)}...` : key} [${[...owners].join(", ")}]`,
			);
	}
	for (const [name, sources] of fragments)
		for (const [path, text] of sources) {
			if (!path.match(FRAGMENT)?.[1]) continue;
			const twin = [...sources].find(
				([other, body]) => other !== path && body === text,
			);
			if (twin)
				result.overrides.push(
					`${path} matches ${twin[0]} up to vocabulary (${name})`,
				);
		}
	return result;
}

export function parityReport(result: Parity): string[] {
	return [
		...result.unlisted.map((line) => `unlisted  ${line}`),
		...[...result.listed].map(
			([d, lines]) => `listed    ${lines} lines: ${d.reason}`,
		),
		...result.overrides.map((line) => `override  ${line}`),
		...[...result.own].map(
			([path, lines]) => `own       ${path}: ${lines} lines`,
		),
	];
}
