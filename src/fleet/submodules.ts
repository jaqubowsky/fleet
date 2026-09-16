export function submodulePaths(status: string): string[] {
	return status
		.split("\n")
		.map((line) => line.trim().split(/\s+/)[1])
		.filter((path): path is string => Boolean(path));
}

export function parentDir(path: string): string {
	const index = path.lastIndexOf("/");
	return index < 0 ? "." : path.slice(0, index);
}
