import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "../..");
const extensionRoot = join(root, "extensions");
const moduleRoot = process.env.PI_NPM_MODULES ?? join(homedir(), ".pi/agent/npm/node_modules");
const esbuild = join(moduleRoot, "esbuild/bin/esbuild");
const output = mkdtempSync(join(tmpdir(), "pi-extension-syntax-"));
const files = readdirSync(extensionRoot, { withFileTypes: true }).flatMap((entry) => {
	if (entry.isFile() && entry.name.endsWith(".ts")) return [join(extensionRoot, entry.name)];
	const index = join(extensionRoot, entry.name, "index.ts");
	return entry.isDirectory() && existsSync(index) ? [index] : [];
}).concat([join(root, "pi", "extensions.ts")]);
const failures = [];

for (const [index, file] of files.entries()) {
	const target = join(output, `${index}-${basename(file)}.mjs`);
	const result = spawnSync(
		esbuild,
		[
			file,
			"--bundle",
			"--platform=node",
			"--format=esm",
			`--outfile=${target}`,
			"--log-level=error",
		],
		{ encoding: "utf8", env: { ...process.env, NODE_PATH: moduleRoot } },
	);
	if (result.status !== 0) {
		failures.push(`${file}: ${result.stderr.trim()}`);
		continue;
	}
	try {
		const loaded = await import(`${pathToFileURL(target)}?${Date.now()}`);
		if (typeof loaded.default !== "function") failures.push(`${file}: missing default factory`);
	} catch (error) {
		failures.push(`${file}: ${error.message}`);
	}
}

rmSync(output, { recursive: true, force: true });
for (const failure of failures) process.stderr.write(`FAIL  extension contract  ${failure}\n`);
process.stdout.write(`extension contract: ${files.length - failures.length} passed, ${failures.length} failed\n`);
process.exitCode = failures.length === 0 ? 0 : 1;
