import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fakeIo } from "../fleet/fake-io.ts";
import { realIo } from "../fleet/io.ts";
import { HARNESSES } from "../harness.ts";
import { REAL_PROFILES, WITH_PRIVATE } from "../profile/fixture.ts";
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
		"read /root/host/repos.json": REAL_PROFILES,
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

test("pi and omp each carry their own theme, and only pi draws its status line itself", () => {
	const file = (path: string, body: string) => ({ [`read /root/${path}`]: body, [`stat /root/${path}`]: { size: body.length, mtime: new Date(0), dir: false } });
	const themes = { ...file("pi/themes/ayu-mirage.json", "pi theme\n"), ...file("omp/themes/ayu-mirage.json", "omp theme\n"), ...file("extensions/statusline.ts", "footer\n") };
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
	assert.equal(pi.files["/stage/home/agent/extensions/statusline.ts"], "footer\n");
	assert.equal(omp.files["/stage/home/agent/extensions/statusline.ts"], undefined);
});

test("a pi or omp container carries the state relay for herdr's integration, and neither host does", () => {
	const relay = { "read /root/extensions/state-relay.ts": "relay\n", "stat /root/extensions/state-relay.ts": { size: 6, mtime: new Date(0), dir: false } };
	const pi = fakeIo(sources(relay));
	const omp = fakeIo(sources({ ...relay, "read /root/omp/fragments/agent-explorer.md": "tools: read\n" }), HARNESSES.omp);

	for (const io of [pi, omp]) {
		render({ root: "/root", harness: io.harness, seat: "host", out: "/home" }, io);
		render({ root: "/root", harness: io.harness, seat: "container", out: "/stage" }, io);
	}

	assert.equal(pi.files["/stage/home/agent/extensions/state-relay.ts"], "relay\n");
	assert.equal(omp.files["/stage/home/agent/extensions/state-relay.ts"], "relay\n");
	assert.equal(pi.files["/home/agent/extensions/state-relay.ts"], undefined);
	assert.equal(omp.files["/home/agent/extensions/state-relay.ts"], undefined);
});

test("every container carries status history beside each module that imports it, and no host does", () => {
	const history = { "read /root/extensions/status-history.ts": "history\n", "stat /root/extensions/status-history.ts": { size: 8, mtime: new Date(0), dir: false } };
	const pi = fakeIo(sources(history));
	const omp = fakeIo(sources({ ...history, "read /root/omp/fragments/agent-explorer.md": "tools: read\n" }), HARNESSES.omp);
	const claude = fakeIo(sources(history), HARNESSES.claude);

	for (const io of [pi, omp, claude]) {
		render({ root: "/root", harness: io.harness, seat: "host", out: "/home" }, io);
		render({ root: "/root", harness: io.harness, seat: "container", out: "/stage" }, io);
	}

	for (const io of [pi, omp]) {
		assert.equal(io.files["/stage/home/agent/extensions/status-history.ts"], "history\n");
		assert.equal(io.files["/stage/context/extensions/status-history.ts"], "history\n");
	}
	assert.equal(claude.files["/stage/home/fleet/extensions/status-history.ts"], "history\n");
	for (const io of [pi, omp, claude]) assert.deepEqual(Object.keys(io.files).filter((path) => path.startsWith("/home/") && path.endsWith("status-history.ts")), []);
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

function renderSeats(name: keyof typeof HARNESSES, read: (out: string) => void): void {
	const out = mkdtempSync(join(tmpdir(), `render-${name}-`));
	try {
		const io = { ...realIo(out, HARNESSES[name]), log: () => {} };
		render({ root, harness: HARNESSES[name], seat: "host", out: `${out}/host` }, io);
		render({ root, harness: HARNESSES[name], seat: "container", out: `${out}/container` }, io);
		read(out);
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
}

function rendered(out: string, seat: string, suffix: string): string {
	const file = (readdirSync(`${out}/${seat}`, { recursive: true }) as string[]).find((path) => path.endsWith(suffix));
	assert.ok(file, `${seat} has no ${suffix}`);
	return readFileSync(join(out, seat, file), "utf8");
}

for (const name of Object.keys(HARNESSES) as (keyof typeof HARNESSES)[]) {
	test(`${name} renders both seats from the real sources with every token resolved`, () => {
		renderSeats(name, (out) => {
			const leftovers = (readdirSync(out, { recursive: true }) as string[])
				.filter((file) => file.endsWith(".md"))
				.filter((file) => /\{\{[a-z]/.test(readFileSync(join(out, file), "utf8")));
			assert.deepEqual(leftovers, []);
		});
	});
}

for (const name of Object.keys(HARNESSES) as (keyof typeof HARNESSES)[]) {
	test(`${name} gives both seats the CI ref, and the skills that read CI point at it without a copy`, () => {
		renderSeats(name, (out) => {
			const pointer = HARNESSES[name].tokens["refs.ci"]!;

			const refs = [rendered(out, "host", "refs/ci.md"), rendered(out, "container", "refs/ci.md")];
			const skills = [rendered(out, "host", "orchestrating-agent-sessions/SKILL.md"), rendered(out, "container", "babysit-pr/SKILL.md")];

			for (const ref of refs) {
				assert.ok(ref.includes("gh run list --commit <sha> --json status,conclusion,name"), "ref names the CI read");
				assert.ok(ref.includes("gh pr view <n> --json headRefOid"), "ref names where the full SHA comes from");
			}
			for (const skill of skills) {
				assert.ok(skill.includes(pointer), "skill points at the CI ref");
				assert.doesNotMatch(skill, /statusCheckRollup|check runs|gh pr checks|Checks permission|--json headRefOid/);
			}
		});
	});
}

for (const name of Object.keys(HARNESSES) as (keyof typeof HARNESSES)[]) {
	test(`${name} gives both seats the one ticket template, and to-tickets and the host point at it without a copy`, () => {
		renderSeats(name, (out) => {
			const pointer = HARNESSES[name].tokens["refs.ticket"]!;

			for (const seat of ["host", "container"]) assert.equal(rendered(out, seat, "refs/ticket.md"), readFileSync(join(root, "templates/project/spec/ticket.md"), "utf8"));
			for (const skill of [rendered(out, "host", "orchestrating-agent-sessions/SKILL.md"), rendered(out, "container", "to-tickets/SKILL.md")]) {
				assert.ok(skill.includes(pointer), "skill points at the ticket template");
				assert.ok(skill.includes("`spec/ticket.md`"), "skill names the project's own template first");
				assert.doesNotMatch(skill, /<ticket-template>|## Acceptance criteria/);
			}
		});
	});
}

for (const name of Object.keys(HARNESSES) as (keyof typeof HARNESSES)[]) {
	test(`${name} tells the host which ticket of a wave goes up first, and both seats that one ordered ticket ends at ready-for-host`, () => {
		renderSeats(name, (out) => {
			const breakTables = (seat: string) =>
				(readdirSync(`${out}/${seat}`, { recursive: true }) as string[])
					.filter((file) => file.endsWith(".md"))
					.map((file) => readFileSync(join(out, seat, file), "utf8"))
					.filter((text) => text.includes("| Natural break |"));
			assert.match(rendered(out, "host", "orchestrating-agent-sessions/SKILL.md"), /within a wave the ticket the most open tickets wait on goes up first/);
			for (const seat of ["host", "container"]) {
				const tables = breakTables(seat);
				assert.notEqual(tables.length, 0, `${seat} has no natural-break table`);
				for (const table of tables) {
					assert.ok(table.includes("| the run's last commit is in, and nothing a user sees is left unverified | `ready-for-host`, with no session for a next ticket |"), `${seat} table lacks the one-ticket break`);
				}
			}
		});
	});
}

for (const name of Object.keys(HARNESSES) as (keyof typeof HARNESSES)[]) {
	test(`${name} seats branch on no permission level; the profile's description holds each level's sentence`, () => {
		renderSeats(name, (out) => {
			const branches = (readdirSync(out, { recursive: true }) as string[])
				.filter((file) => file.endsWith(".md"))
				.flatMap((file) => readFileSync(join(out, file), "utf8").split("\n").map((line) => `${file}: ${line}`))
				.filter((line) => /`(auto|human|none|read|write)`/.test(line) && /\b(push|pr|pull request|merge|sign|linear)\b/i.test(line))
				.filter((line) => !line.includes("the level your permissions give"));
			assert.deepEqual(branches, []);
			assert.match(rendered(out, "host", "orchestrating-agent-sessions/SKILL.md"), /order the plan so the checks that judge a merge exist before the first change they judge, and the widest parallel wave starts as early as possible/i);
			assert.doesNotMatch(rendered(out, "host", "orchestrating-agent-sessions/SKILL.md"), /skeleton with CI/);
		});
	});
}

test("the claude host watches the containers its own pane put up or steered last", () => {
	renderSeats("claude", (out) => {
		const rules = (readdirSync(`${out}/host`, { recursive: true }) as string[])
			.filter((file) => file.endsWith(".md"))
			.map((file) => readFileSync(join(out, "host", file), "utf8"))
			.join("\n");

		assert.match(rules, /With no names it follows the containers whose latest `cfleet up` or `cfleet steer` came from this herdr pane/);
		assert.doesNotMatch(rules, /watches every `claude-` container/);
	});
});

test("a profile that gives the host Linear adds its server to pi and omp mcp.json, beside the servers already there", () => {
	const profiles = {
		"read /root/host/repos.json": WITH_PRIVATE,
		"read /home/agent/mcp.json": JSON.stringify({ mcpServers: { context7: { url: "https://mcp.context7.com/mcp" } } }),
		"read /root/pi/profiles/host.json": JSON.stringify({ packages: ["npm:pi-lens@4.1.3"] }),
		"read /root/pi/profiles/sbx.json": JSON.stringify({ packages: ["npm:pi-lens@4.1.3", "npm:pi-mcp-adapter@2.32.0"] }),
	};
	const pi = fakeIo(sources(profiles));
	const omp = fakeIo(sources({ ...profiles, "read /root/omp/fragments/agent-explorer.md": "tools: read\n" }), HARNESSES.omp);

	for (const io of [pi, omp]) render({ root: "/root", harness: io.harness, seat: "host", out: "/home" }, io);

	assert.deepEqual(JSON.parse(pi.files["/home/agent/mcp.json"]).mcpServers, {
		context7: { url: "https://mcp.context7.com/mcp" },
		"linear-private": { url: "https://mcp.linear.app/mcp", auth: "oauth" },
	});
	assert.deepEqual(JSON.parse(pi.files["/home/agent/settings.json"]).packages, ["npm:pi-lens@4.1.3", "npm:pi-mcp-adapter@2.32.0"]);
	assert.deepEqual(JSON.parse(omp.files["/home/agent/mcp.json"]).mcpServers, {
		context7: { url: "https://mcp.context7.com/mcp" },
		"linear-private": { type: "http", url: "https://mcp.linear.app/mcp" },
	});
});

test("with no host Linear server in any profile, the host render writes no mcp.json and loads no adapter", () => {
	const silent = Object.fromEntries(Object.entries(JSON.parse(WITH_PRIVATE)).map(([match, entry]: [string, any]) => [match, { ...entry, host: { ...entry.host, linear: "none", linearServer: undefined } }]));
	const profiles = { "read /root/host/repos.json": JSON.stringify(silent) };
	const pi = fakeIo(sources({ ...profiles, "read /root/pi/profiles/host.json": JSON.stringify({ packages: ["npm:pi-lens@4.1.3"] }) }));
	const omp = fakeIo(sources({ ...profiles, "read /root/omp/fragments/agent-explorer.md": "tools: read\n" }), HARNESSES.omp);

	for (const io of [pi, omp]) render({ root: "/root", harness: io.harness, seat: "host", out: "/home" }, io);

	assert.equal(pi.files["/home/agent/mcp.json"], undefined);
	assert.equal(omp.files["/home/agent/mcp.json"], undefined);
	assert.deepEqual(JSON.parse(pi.files["/home/agent/settings.json"]).packages, ["npm:pi-lens@4.1.3"]);
});

for (const name of Object.keys(HARNESSES) as (keyof typeof HARNESSES)[]) {
	test(`${name} seats review by blast radius, and the image carries the ticket check the gate runs`, () => {
		renderSeats(name, (out) => {
			const promises = (readdirSync(out, { recursive: true }) as string[])
				.filter((file) => file.endsWith(".md"))
				.flatMap((file) => readFileSync(join(out, file), "utf8").split("\n").map((line) => `${file}: ${line}`))
				.filter((line) => /(?<!at most )one review per ticket|one review and one commit|review of its uncommitted diff before its one commit|the reviewed work|and its review before the commit|when a review of the task names a shared seam|reviewer sub-agent already reviews/i.test(line));
			assert.deepEqual(promises, []);
			assert.match(rendered(out, "container", "implement/SKILL.md"), /blast radius/);
			assert.match(rendered(out, "container", "implement/SKILL.md"), /`ticket-check <ticket file>`/);
			assert.match(rendered(out, "host", "orchestrating-agent-sessions/SKILL.md"), /Log line on the review decision/);
			assert.match(rendered(out, "container", "context/Dockerfile"), /container\/ticket-check\.sh\s+\/usr\/local\/bin\/ticket-check/);
			assert.ok(rendered(out, "container", "context/container/ticket-check.sh").includes("not done"));
		});
	});
}

for (const name of Object.keys(HARNESSES) as (keyof typeof HARNESSES)[]) {
	test(`${name} verifies what a user sees the way project.md names, with no browser in the container rules`, () => {
		renderSeats(name, (out) => {
			const files = (readdirSync(out, { recursive: true }) as string[]).filter((file) => file.endsWith(".md"));
			const rules = files.filter((file) => file.startsWith("container/") && /(^|\/)(AGENTS|CLAUDE)\.md$|\/rules\/[^/]+\.md$/.test(file));
			assert.ok(rules.length > 0);
			for (const file of rules) assert.doesNotMatch(readFileSync(join(out, file), "utf8"), /browser/i, file);
			const triggers = files
				.flatMap((file) => readFileSync(join(out, file), "utf8").split("\n").map((line) => `${file}: ${line}`))
				.filter((line) => /changes a shared seam|`check-regressions` (runs|follows)/.test(line));
			assert.equal(triggers.length, 1, triggers.join("\n"));
			assert.match(triggers[0]!, /check-regressions\/SKILL\.md: description:/);
			assert.match(rendered(out, "container", "refs/ticket.md"), /- \[ \] Seen: /);
			assert.match(rendered(out, "container", "implement/SKILL.md"), /`Seen:`/);
			assert.match(rendered(out, "container", "refs/artifacts.md"), /\| `testing` \| the verification of what a user sees/);
		});
	});
}

for (const name of Object.keys(HARNESSES) as (keyof typeof HARNESSES)[]) {
	test(`${name} container checkpoints, asks through attention, names host items and cuts small tickets`, () => {
		renderSeats(name, (out) => {
			const implement = rendered(out, "container", "implement/SKILL.md");
			assert.match(implement, /Commit the first coherent vertical piece before widening/);
			assert.match(implement, /In a short run, or on an order naming this one ticket, the rest stays in this ticket/);
			assert.match(implement, /name the acceptance line most likely to be false and make the check that would catch it the first red of step 5/);
			const rules = (readdirSync(`${out}/container`, { recursive: true }) as string[])
				.filter((file) => /(^|\/)(AGENTS|CLAUDE)\.md$|\/rules\/[^/]+\.md$/.test(file))
				.map((file) => readFileSync(join(out, "container", file), "utf8"))
				.join("\n");
			assert.match(rules, /A question for the host goes into `attention:` under `status: blocked`, and the turn ends there\. Never a `\w+` dialog here/);
			assert.equal(rendered(out, "container", "refs/artifacts.md").match(/every host action (is )?named in Next step, never counted, and in Summary once Next step is full/g)?.length, 2);
			assert.match(rendered(out, "container", "to-tickets/SKILL.md"), /cut small, so each commit reads as one change: one behaviour per ticket, still a complete path through every layer/);
			assert.match(rendered(out, "container", "refs/ticket.md"), /past 500 it is two tickets/);
		});
	});
}

for (const name of Object.keys(HARNESSES) as (keyof typeof HARNESSES)[]) {
	test(`${name} reviewer opens review.md with PASS or FAIL and blocks only a proven break of an acceptance line`, () => {
		renderSeats(name, (out) => {
			const reviewer = rendered(out, "container", "agents/reviewer.md");
			assert.match(reviewer, /```md\nPASS <head-sha> \| FAIL <head-sha>\n/);
			assert.match(reviewer, /P0 is a `proven` break of an acceptance line, quoted, and the only one that blocks/);
			assert.match(reviewer, /The first line is `FAIL` on any P0, `PASS` otherwise/);
			assert.match(reviewer, /proven \| plausible \| unverified/);
			assert.doesNotMatch(reviewer, /Verdict: OK/);
			const skill = rendered(out, "container", "two-axis-review/SKILL.md");
			assert.doesNotMatch(skill, /two axes/i);
		});
	});
}

for (const name of Object.keys(HARNESSES) as (keyof typeof HARNESSES)[]) {
	test(`${name} babysit-pr waits on CI without holding the session`, () => {
		renderSeats(name, (out) => {
			const skill = rendered(out, "container", "babysit-pr/SKILL.md");
			if (name === "claude") assert.match(skill, /`run_in_background: true`/);
			else assert.match(skill, /one read per tool call.*up to twenty calls/);
			assert.doesNotMatch(skill, /The wait blocks on purpose/);
			assert.match(skill, /the settled state as a `## Log` line in `status.md`/);
			const core = rendered(out, "container", name === "claude" ? "rules/core.md" : "AGENTS.md");
			assert.match(core, /a poll loop is not work, except a bounded wait on an external system/);
		});
	});
}

for (const name of Object.keys(HARNESSES) as (keyof typeof HARNESSES)[]) {
	test(`${name} updates a pull request body through the REST API and reads colours from computed styles`, () => {
		renderSeats(name, (out) => {
			assert.ok(rendered(out, "container", "babysit-pr/SKILL.md").includes("gh api -X PATCH repos/<owner>/<repo>/pulls/<number> -F body=@<file>"));
			assert.match(rendered(out, "container", "check-feature/SKILL.md"), /`getComputedStyle`/);
		});
	});
}
