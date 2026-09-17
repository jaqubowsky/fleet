export type Source = { name: string; body: string };

export function buildAgents(sources: Source[], exclude: string[]): string {
	return sources
		.filter((s) => !exclude.includes(s.name))
		.map((s) => `${s.body.trimEnd()}\n`)
		.join("\n");
}
