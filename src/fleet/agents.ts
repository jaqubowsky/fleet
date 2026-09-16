export type Source = { name: string; body: string };

export function expandIncludes(body: string, read: (path: string) => string | undefined): string {
	return body
		.split("\n")
		.map((line) => {
			const match = /^@(\/.*)$/.exec(line);
			if (!match) return line;
			const included = read(match[1]);
			if (included === undefined) throw new Error(`include not found: ${match[1]}`);
			return included.trimEnd();
		})
		.join("\n");
}

export function buildAgents(sources: Source[], exclude: string[], read: (path: string) => string | undefined): string {
	return sources
		.filter((s) => !exclude.includes(s.name))
		.map((s) => `${expandIncludes(s.body, read).trimEnd()}\n`)
		.join("\n");
}
