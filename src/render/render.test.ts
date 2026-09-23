import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fakeIo } from "../fleet/fake-io.ts";
import { realIo } from "../fleet/io.ts";
import { HARNESSES } from "../harness.ts";
import { render, renderText } from "./render.ts";

const root = resolve(import.meta.dirname, "../..");

function sources(extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		"list /root/rules": ["host.md", "core.md"],
		"read /root/rules/core.md": "# Core\nask with {{tool.ask}}\n",
		"read /root/rules/host.md": "# Host\nrun {{cli}} steer\n",
		"read /root/sbx/container/sandbox.md": "# Container\nleaves at {{cli}} land\n",
		"read /root/agents/explorer.md": "---\nname: explorer\n{{file:agent-explorer}}\n---\n",
		"read /root/agents/researcher.md": "---\nname: researcher\n---\n",
		"read /root/agents/reviewer.md": "---\nname: reviewer\n---\n",
		"read /root/pi/fragments/agent-explorer.md": "tools: read, grep\n",
		"read /root/claude/fragments/agent-explorer.md": "tools: Read, Grep\n",
		"read /root/claude/CLAUDE.md": "Rules live in rules/.\n",
		"read /root/sbx/container/toolchain.Dockerfile": "RUN install node\n",
		"read /root/pi/sbx/Dockerfile": "FROM pi-base\n\n{{toolchain}}\n\nCMD [\"pi\"]\n",
		"read /root/omp/sbx/Dockerfile": "FROM omp-base\n\n{{toolchain}}\n",
		"read /root/claude/sbx/Dockerfile": "FROM claude-base\n\n{{toolchain}}\n",
		"read /root/claude/sbx/stage.sh": "BUILD_ARGS+=(--build-arg X=1)\n",
		...extra,
	};
}

test("a token the harness does not define stops the render and names the file", () => {
	assert.throws(() => renderText("run {{nope}}", {}, () => undefined, "rules/core.md"), /rules\/core\.md: unresolved token \{\{nope\}\}/);
	assert.throws(() => renderText("{{file:gone}}", {}, () => undefined, "agents/x.md"), /agents\/x\.md: unresolved token \{\{file:gone\}\}/);
});

test("a fragment is inlined without its trailing newline", () => {
	assert.equal(renderText("a\n{{file:f}}\nb", {}, () => "one\ntwo\n", "x"), "a\none\ntwo\nb");
});

test("an image takes the shared toolchain between its own lines", () => {
	const io = fakeIo(sources());

	render({ root: "/root", harness: HARNESSES.pi, seat: "container", out: "/stage" }, io);

	assert.equal(io.files["/stage/context/Dockerfile"], "FROM pi-base\n\nRUN install node\n\nCMD [\"pi\"]\n");
});

test("pi and omp each carry their own theme", () => {
	const file = (path: string, body: string) => ({ [`read /root/${path}`]: body, [`stat /root/${path}`]: { size: body.length, mtime: new Date(0), dir: false } });
	const themes = { ...file("pi/themes/ayu-mirage.json", "pi theme\n"), ...file("omp/themes/ayu-mirage.json", "omp theme\n") };
	const pi = fakeIo(sources(themes));
	const omp = fakeIo(sources({ ...themes, "read /root/omp/fragments/agent-explorer.md": "tools: read\n" }), HARNESSES.omp);

	for (const io of [pi, omp]) {
		render({ root: "/root", harness: io.harness, seat: "host", out: "/home" }, io);
		render({ root: "/root", harness: io.harness, seat: "container", out: "/stage" }, io);
	}

	assert.equal(pi.files["/home/agent/themes/ayu-mirage.json"], "pi theme\n");
	assert.equal(pi.files["/stage/home/agent/themes/ayu-mirage.json"], "pi theme\n");
	assert.equal(omp.files["/home/agent/themes/ayu-mirage.json"], "omp theme\n");
	assert.equal(omp.files["/stage/home/agent/themes/ayu-mirage.json"], "omp theme\n");
});

test("pi folds the rules into one AGENTS.md and keeps host.md out of the container", () => {
	const io = fakeIo(sources());

	render({ root: "/root", harness: HARNESSES.pi, seat: "host", out: "/home" }, io);
	render({ root: "/root", harness: HARNESSES.pi, seat: "container", out: "/stage" }, io);

	assert.equal(io.files["/home/agent/AGENTS.md"], "# Core\nask with ask_user_question\n\n# Host\nrun fleet steer\n");
	assert.equal(io.files["/stage/home/agent/AGENTS.md"], "# Core\nask with ask_user_question\n\n# Container\nleaves at fleet land\n");
	assert.equal(io.files["/home/agent/agents/explorer.md"], "---\nname: explorer\ntools: read, grep\n---\n");
});

test("claude keeps one file per rule, its own tool names and CLAUDE.md", () => {
	const io = fakeIo(sources(), HARNESSES.claude);

	render({ root: "/root", harness: HARNESSES.claude, seat: "host", out: "/home" }, io);
	render({ root: "/root", harness: HARNESSES.claude, seat: "container", out: "/stage" }, io);

	assert.equal(io.files["/home/rules/core.md"], "# Core\nask with AskUserQuestion\n");
	assert.equal(io.files["/home/rules/host.md"], "# Host\nrun cfleet steer\n");
	assert.equal(io.files["/home/agents/explorer.md"], "---\nname: explorer\ntools: Read, Grep\n---\n");
	assert.equal(io.files["/home/CLAUDE.md"], "Rules live in rules/.\n");
	assert.equal(io.files["/stage/home/rules/sandbox.md"], "# Container\nleaves at cfleet land\n");
	assert.equal(io.files["/stage/home/rules/host.md"], undefined);
});

test("claude agents and container settings take their seat's model and effort", () => {
	const io = fakeIo(
		sources({
			"read /root/claude/fragments/agent-explorer.md":
				"tools: Read, Grep\nmodel: {{models.explorer}}\neffort: {{thinking.explorer}}\n",
			"read /root/claude/profiles/models.json": JSON.stringify({
				seats: {
					sbx: { model: "anthropic/claude-opus-5-5[1m]", thinking: "xhigh" },
					explorer: { model: "anthropic/claude-sonnet-5", thinking: "high" },
				},
			}),
			"read /root/claude/profiles/settings.json": '{"$schema":"x"}',
			"read /root/claude/profiles/sbx.json":
				'{"model":"{{models.sbx}}","effortLevel":"{{thinking.sbx}}"}',
		}),
		HARNESSES.claude,
	);

	render({ root: "/root", harness: HARNESSES.claude, seat: "host", out: "/home" }, io);
	render({ root: "/root", harness: HARNESSES.claude, seat: "container", out: "/stage" }, io);

	assert.equal(
		io.files["/home/agents/explorer.md"],
		"---\nname: explorer\ntools: Read, Grep\nmodel: claude-sonnet-5\neffort: high\n---\n",
	);
	assert.deepEqual(JSON.parse(io.files["/stage/context/settings.json"]!), {
		$schema: "x",
		model: "claude-opus-5-5[1m]",
		effortLevel: "xhigh",
	});
});

test("omp renders YAML model overrides and removes its legacy host JSON", () => {
	const models = `${JSON.stringify(
		{
			providers: {
				"openai-codex": {
					modelOverrides: {
						"gpt-6-sol": { contextWindow: 1050000 },
					},
				},
			},
		},
		null,
		2,
	)}\n`;
	const io = fakeIo(
		sources({
			"read /root/omp/fragments/agent-explorer.md": "tools: read, grep\n",
			"read /root/pi/models.json": models,
			"stat /root/pi/models.json": { size: models.length, mtime: new Date(0), dir: false },
		}),
		HARNESSES.omp,
	);
	io.files["/home/agent/models.json"] = "legacy";

	render({ root: "/root", harness: HARNESSES.omp, seat: "host", out: "/home" }, io);
	render({ root: "/root", harness: HARNESSES.omp, seat: "container", out: "/stage" }, io);

	assert.equal(io.files["/home/agent/models.yml"], models);
	const renderedModels = JSON.parse(io.files["/home/agent/models.yml"]!);
	assert.equal(renderedModels.providers["openai-codex"].modelOverrides["gpt-6-sol"].contextWindow, 1050000);
	assert.equal(io.files["/home/agent/models.json"], undefined);
	assert.equal(io.files["/stage/home/agent/models.yml"], models);
});

test("a skill, rule or agent gone from the sources is gone from the home after the next render", () => {
	const io = fakeIo(sources(), HARNESSES.claude);
	io.files["/home/skills/retired/SKILL.md"] = "old";
	io.files["/home/rules/env.md"] = "old";
	io.files["/home/settings.json"] = "{}";

	render({ root: "/root", harness: HARNESSES.claude, seat: "host", out: "/home" }, io);

	assert.equal(io.files["/home/skills/retired/SKILL.md"], undefined);
	assert.equal(io.files["/home/rules/env.md"], undefined);
	assert.equal(io.files["/home/settings.json"], "{}");
	assert.equal(io.files["/home/rules/core.md"], "# Core\nask with AskUserQuestion\n");
});

for (const name of Object.keys(HARNESSES) as (keyof typeof HARNESSES)[]) {
	test(`${name} renders both seats from the real sources with every token resolved`, () => {
		const out = mkdtempSync(join(tmpdir(), `render-${name}-`));
		try {
			const io = { ...realIo(out, HARNESSES[name]), log: () => {} };
			render({ root, harness: HARNESSES[name], seat: "host", out: `${out}/host` }, io);
			render({ root, harness: HARNESSES[name], seat: "container", out: `${out}/container` }, io);
			const leftovers = (readdirSync(out, { recursive: true }) as string[])
				.filter((file) => file.endsWith(".md"))
				.filter((file) => /\{\{[a-z]/.test(readFileSync(join(out, file), "utf8")));
			assert.deepEqual(leftovers, []);
		} finally {
			rmSync(out, { recursive: true, force: true });
		}
	});
}
