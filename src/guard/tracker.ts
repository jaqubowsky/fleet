const REPLACING = /^mcp__linear[\w-]*__save_(comment|issue)$/;

export function trackerEditQuestion(tool: string, input: Record<string, unknown>): string | undefined {
	return REPLACING.test(tool) && input.id !== undefined && (input.body !== undefined || input.description !== undefined)
		? "This Linear call replaces the whole text of an existing comment or description, so it overwrites any edit the person made since you last read it; this dialog asks for it."
		: undefined;
}
