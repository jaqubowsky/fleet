import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { realIo } from "../fleet/io.ts";
import { type AgentName, KINDS } from "../harness.ts";
import { render } from "./render.ts";

export type Misplaced = { at: string; names: string; owner: string };

const CONTAINER_OWNER = "sbx/container/sandbox.md";
const HOST_OWNER = "skills/host/orchestrating-agent-sessions/SKILL.md";
const SEAT_OWNERS = `${CONTAINER_OWNER} or ${HOST_OWNER}`;

const MECHANICS = [
	/status\.md/,
	/attention:/,
	/analysis\.md/,
	/spec\.md/,
	/(?<![.\w])issues\//,
	/permissions\.md/,
	/project\.md/,
	/ready-for-host/,
	/status: (new|analyzing|implementing|reviewing|testing|paused|pr-open|blocked)\b/,
	/task director/i,
	/\$FLEET_ARTIFACTS/,
	/\$SANDBOX_NAME/,
	/\{\{refs\}\}/,
	/natural break/i,
	/session handoff/i,
	/ticket-check/,
	/\{\{cli\}\}/,
	/\bthe host\b/i,
];

const OWN_OUTPUT: Record<string, RegExp> = { "to-tickets": /spec\.md/ };

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
	);
}

export function layerSources(root: string): Record<string, string> {
	const files = [
		...walk(join(root, "skills")),
		...walk(join(root, "rules")),
	].filter((f) => f.endsWith(".md"));
	return Object.fromEntries(
		files.map((f) => [relative(root, f), readFileSync(f, "utf8")]),
	);
}

type Layer = { names: (line: string) => string[]; owner: string };

export function misplaced(sources: Record<string, string>): Misplaced[] {
	const skills = [
		...new Set(
			Object.keys(sources).flatMap(
				(f) => f.match(/^skills\/[^/]+\/([^/]+)\//)?.[1] ?? [],
			),
		),
	];
	const seatSkills = new Set(
		Object.keys(sources).flatMap(
			(f) => f.match(/^skills\/(?:container|host)\/([^/]+)\//)?.[1] ?? [],
		),
	);
	const namesSkill = (line: string, except?: string) =>
		skills.filter(
			(s) => s !== except && new RegExp(`\`${s}\`|skill \`?${s}\\b`).test(line),
		);
	const namesMechanic = (line: string, own?: RegExp) =>
		MECHANICS.flatMap((m) => line.match(m)?.[0] ?? []).filter(
			(hit) => !own?.test(hit),
		);
	const layerOf = (file: string): Layer | undefined => {
		const skill = file.match(/^skills\/(container|host|shared)\/([^/]+)\//);
		if (skill && file !== HOST_OWNER) {
			const [, seat, name] = skill;
			return {
				names: (line) => [
					...namesSkill(line, name),
					...namesMechanic(line, OWN_OUTPUT[name]),
				],
				owner:
					seat === "container"
						? CONTAINER_OWNER
						: seat === "host"
							? HOST_OWNER
							: SEAT_OWNERS,
			};
		}
		if (file === "rules/core.md" || file === "rules/delegation.md")
			return {
				names: (line) => [
					...namesSkill(line).filter((s) => seatSkills.has(s)),
					...namesMechanic(line),
				],
				owner: SEAT_OWNERS,
			};
		if (file.startsWith("rules/refs/"))
			return { names: (line) => namesSkill(line), owner: CONTAINER_OWNER };
	};
	return Object.entries(sources).flatMap(([file, text]) => {
		const layer = layerOf(file);
		if (!layer) return [];
		return text.split("\n").flatMap((line, i) => {
			const names = layer.names(line);
			return names.length
				? [{ at: `${file}:${i + 1}`, names: names.join(", "), owner: layer.owner }]
				: [];
		});
	});
}

const HOST_CHECK =
	/\bhost('s|-side)? (\w+ )?(acceptance|accepts|review\w*|checks|verifies)\b/i;

export function containerTexts(root: string): Record<string, string> {
	const out = mkdtempSync(join(tmpdir(), "layers-"));
	try {
		return Object.fromEntries(
			(Object.keys(KINDS) as AgentName[]).flatMap((name) => {
				const dir = join(out, name);
				render(
					{ root, agent: name, seat: "container", out: dir },
					{ ...realIo(out), log: () => {} },
				);
				return walk(dir)
					.filter((f) => /\.(md|ts)$/.test(f))
					.map((f) => [`${name}/${relative(dir, f)}`, readFileSync(f, "utf8")]);
			}),
		);
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
}

export function hostChecks(texts: Record<string, string>): string[] {
	return Object.entries(texts).flatMap(([file, text]) =>
		text
			.split("\n")
			.flatMap((line, i) => (HOST_CHECK.test(line) ? [`${file}:${i + 1}`] : [])),
	);
}
