const RESERVED_MIB = 2048;
const MIN_HEAP_MIB = 512;
const STEP_MIB = 512;

export function memoryMiB(memory: string): number {
	const match = /^(\d+)([mg])$/i.exec(memory.trim());
	if (!match) throw new Error(`memory must look like 8g or 4096m, got ${memory}`);
	const amount = Number(match[1]);
	return match[2].toLowerCase() === "g" ? amount * 1024 : amount;
}

export function nodeHeapMiB(memory: string): number {
	const total = memoryMiB(memory);
	const ceiling = total - RESERVED_MIB;
	if (ceiling < MIN_HEAP_MIB) throw new Error(`sandbox memory must exceed ${RESERVED_MIB + MIN_HEAP_MIB} MiB`);
	const proportional = Math.floor((total * 0.4) / STEP_MIB) * STEP_MIB;
	return Math.min(ceiling, Math.max(MIN_HEAP_MIB, proportional));
}
