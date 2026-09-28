import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

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
	/status: (new|analyzing|implementing|reviewing|testing|pr-open|blocked)\b/,
	/task director/i,
	/\$FLEET_ARTIFACTS/,
	/\$SANDBOX_NAME/,
	/\{\{refs\}\}/,
	/natural break/i,
	/session handoff/i,
	/ticket-check/,
	/\{\{cli\}\}/,
	/\bthe host\b/i,
	/\{\{file:/,
];

const OWN_OUTPUT: Record<string, RegExp> = { "to-tickets": /spec\.md/ };

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

export function layerSources(root: string): Record<string, string> {
	const files = [...walk(join(root, "skills")), ...walk(join(root, "rules"))].filter((f) => f.endsWith(".md"));
	return Object.fromEntries(files.map((f) => [relative(root, f), readFileSync(f, "utf8")]));
}

type Layer = { names: (line: string) => string[]; owner: string };

export function misplaced(sources: Record<string, string>): Misplaced[] {
	const skills = [...new Set(Object.keys(sources).flatMap((f) => f.match(/^skills\/[^/]+\/([^/]+)\//)?.[1] ?? []))];
	const namesSkill = (line: string, except?: string) => skills.filter((s) => s !== except && new RegExp(`\`${s}\`|skill \`?${s}\\b`).test(line));
	const namesMechanic = (line: string, own?: RegExp) => MECHANICS.flatMap((m) => line.match(m)?.[0] ?? []).filter((hit) => !own?.test(hit));
	const layerOf = (file: string): Layer | undefined => {
		const skill = file.match(/^skills\/(container|host|shared)\/([^/]+)\//);
		if (skill && file !== HOST_OWNER) {
			const [, seat, name] = skill;
			return { names: (line) => [...namesSkill(line, name), ...namesMechanic(line, OWN_OUTPUT[name])], owner: seat === "container" ? CONTAINER_OWNER : seat === "host" ? HOST_OWNER : SEAT_OWNERS };
		}
		if (file === "rules/core.md" || file === "rules/delegation.md") return { names: (line) => namesMechanic(line), owner: SEAT_OWNERS };
		if (file.startsWith("rules/refs/")) return { names: (line) => namesSkill(line), owner: CONTAINER_OWNER };
	};
	return Object.entries(sources).flatMap(([file, text]) => {
		const layer = layerOf(file);
		if (!layer) return [];
		return text.split("\n").flatMap((line, i) => {
			const names = layer.names(line);
			return names.length ? [{ at: `${file}:${i + 1}`, names: names.join(", "), owner: layer.owner }] : [];
		});
	});
}
