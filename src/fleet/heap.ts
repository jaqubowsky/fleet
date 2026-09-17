export function memoryMiB(memory: string): number {
	const match = /^(\d+)([mg])$/i.exec(memory.trim());
	if (!match) throw new Error(`memory must look like 8g or 4096m, got ${memory}`);
	const amount = Number(match[1]);
	return match[2].toLowerCase() === "g" ? amount * 1024 : amount;
}
