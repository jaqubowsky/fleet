const OWNERS: Record<string, string> = {
	acme: "op://Dev/GitHub PAT webapp/credential",
	globex: "op://Dev/GitHub PAT globex/credential",
	personal: "op://Dev/GitHub PAT Personal/credential",
};

export function ownerKind(origin: string): string {
	const owner = /github\.com[^:/]*[:/]([^/]+)\//i.exec(origin)?.[1]?.toLowerCase();
	if (owner === "acme") return "acme";
	if (owner === "globex" || owner === "bob") return "globex";
	return "personal";
}

export function githubRef(origin: string): string {
	return OWNERS[ownerKind(origin)];
}

export function linearServer(origin: string): string | undefined {
	return ownerKind(origin) === "acme" ? "linear-acme" : undefined;
}
