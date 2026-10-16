import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = new URL("../../claude/sbx/stage.sh", import.meta.url).pathname;

const SERVER = {
	command: "typescript-language-server",
	args: ["--stdio"],
	extensionToLanguage: { ".ts": "typescript" },
};

function stageFrom(home: string): string {
	const plugins = join(home, ".claude/plugins");
	const official = join(plugins, "marketplaces/claude-plugins-official");
	mkdirSync(join(official, ".claude-plugin"), { recursive: true });
	mkdirSync(join(plugins, "cache/claude-plugins-official/typescript-lsp/1.0.0"), { recursive: true });
	writeFileSync(
		join(official, ".claude-plugin/marketplace.json"),
		JSON.stringify({
			name: "claude-plugins-official",
			plugins: [
				{ name: "pyright-lsp", lspServers: { pyright: { command: "pyright-langserver" } } },
				{ name: "typescript-lsp", lspServers: { typescript: SERVER } },
			],
		}),
	);
	writeFileSync(
		join(plugins, "known_marketplaces.json"),
		JSON.stringify({
			"claude-plugins-official": {
				source: { source: "github", repo: "anthropics/claude-plugins-official" },
				installLocation: official,
			},
			harness: {
				source: { source: "directory", path: "/Users/alice/harness/claude/mods" },
				installLocation: "/Users/alice/harness/claude/mods",
			},
		}),
	);
	writeFileSync(
		join(plugins, "installed_plugins.json"),
		JSON.stringify({
			version: 2,
			plugins: { "typescript-lsp@claude-plugins-official": [{ scope: "user", version: "1.0.0" }] },
		}),
	);
	const stage = join(home, "../stage");
	const run = spawnSync("bash", ["-c", `set -e; . "${script}"`], {
		encoding: "utf8",
		env: { ...process.env, HOME: home, STAGE: stage },
	});
	assert.equal(run.status, 0, run.stderr);
	return stage;
}

const staged = (stage: string, path: string) =>
	JSON.parse(readFileSync(join(stage, "plugins", path), "utf8"));

test("the claude image knows only the marketplace its staged plugin comes from", () => {
	const home = join(mkdtempSync(join(tmpdir(), "stage-")), "home");

	const stage = stageFrom(home);

	assert.deepEqual(staged(stage, "known_marketplaces.json"), {
		"claude-plugins-official": {
			source: { source: "github", repo: "anthropics/claude-plugins-official" },
			installLocation: "/home/agent/.claude/plugins/marketplaces/claude-plugins-official",
			autoUpdate: false,
		},
	});
});

