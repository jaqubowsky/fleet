import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fakeIo } from "../fleet/fake-io.ts";
import { realIo } from "../fleet/io.ts";
import { CONTINUE, SEATS, KINDS } from "../harness.ts";
import {
	PRIVATE_PROFILE,
	PRIVATE_REPO,
	SAMPLE_PROFILES,
	WITH_PRIVATE,
} from "../profile/fixture.ts";
import { render, renderText } from "./render.ts";

const root = resolve(import.meta.dirname, "../..");

function sources(extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		"list /root/rules": ["host.md", "core.md"],
		"read /root/rules/core.md": "# Core\nask with {{tool.ask}}\n",
		"read /root/rules/host.md": "# Host\nrun {{cli}} steer\n",
		"read /root/sbx/container/sandbox.md":
			"# Container\nleaves at {{cli}} land\n",
		"read /root/agents/explorer.md":
			"---\nname: explorer\n{{file:agent-explorer}}\n---\n",
		"read /root/agents/researcher.md": "---\nname: researcher\n---\n",
		"read /root/agents/reviewer.md": "---\nname: reviewer\n---\n",
		"read /root/pi/fragments/agent-explorer.md": "tools: read, grep\n",
		"read /root/claude/fragments/agent-explorer.md": "tools: Read, Grep\n",
		"read /root/claude/CLAUDE.md": "Rules live in rules/.\n",
		"read /root/sbx/container/toolchain.Dockerfile": "RUN install node\n",
		"read /root/pi/sbx/Dockerfile":
			'FROM pi-base\n\n{{toolchain}}\n\nCMD ["pi"]\n',
		"read /root/claude/sbx/Dockerfile": "FROM claude-base\n\n{{toolchain}}\n",
		"read /root/claude/sbx/stage.sh": "BUILD_ARGS+=(--build-arg X=1)\n",
		"read /root/host/repos.json": SAMPLE_PROFILES,
		...extra,
	};
}

test("a token the harness does not define stops the render and names the file", () => {
	assert.throws(
		() => renderText("run {{nope}}", {}, () => undefined, "rules/core.md"),
		/rules\/core\.md: unresolved token \{\{nope\}\}/,
	);
	assert.throws(
		() => renderText("{{file:gone}}", {}, () => undefined, "agents/x.md"),
		/agents\/x\.md: unresolved token \{\{file:gone\}\}/,
	);
});

test("a fragment is inlined without its trailing newline", () => {
	assert.equal(
		renderText("a\n{{file:f}}\nb", {}, () => "one\ntwo\n", "x"),
		"a\none\ntwo\nb",
	);
});

test("an image takes the shared toolchain between its own lines", () => {
	const io = fakeIo(sources());

	render({ root: "/root", agent: "pi", seat: "container", out: "/stage" }, io);

	assert.equal(
		io.files["/stage/context/Dockerfile"],
		'FROM pi-base\n\nRUN install node\n\nCMD ["pi"]\n',
	);
});

test("pi carries its own theme and draws its status line itself", () => {
	const file = (path: string, body: string) => ({
		[`read /root/${path}`]: body,
		[`stat /root/${path}`]: { size: body.length, mtime: new Date(0), dir: false },
	});
	const themes = {
		...file("pi/themes/ayu-mirage.json", "pi theme\n"),
		...file("extensions/statusline.ts", "footer\n"),
	};
	const pi = fakeIo(sources(themes));

	render({ root: "/root", agent: "pi", seat: "host", out: "/home" }, pi);
	render({ root: "/root", agent: "pi", seat: "container", out: "/stage" }, pi);

	assert.equal(pi.files["/home/agent/themes/ayu-mirage.json"], "pi theme\n");
	assert.equal(
		pi.files["/stage/home/agent/themes/ayu-mirage.json"],
		"pi theme\n",
	);
	assert.equal(
		pi.files["/stage/home/agent/extensions/statusline.ts"],
		"footer\n",
	);
});

test("a pi container carries the state relay for herdr's integration, and its host does not", () => {
	const relay = {
		"read /root/extensions/state-relay.ts": "relay\n",
		"stat /root/extensions/state-relay.ts": {
			size: 6,
			mtime: new Date(0),
			dir: false,
		},
	};
	const pi = fakeIo(sources(relay));

	render({ root: "/root", agent: "pi", seat: "host", out: "/home" }, pi);
	render({ root: "/root", agent: "pi", seat: "container", out: "/stage" }, pi);

	assert.equal(
		pi.files["/stage/home/agent/extensions/state-relay.ts"],
		"relay\n",
	);
	assert.equal(pi.files["/home/agent/extensions/state-relay.ts"], undefined);
});

test("every container carries the activity recorder beside each module that imports it, and no host does", () => {
	const activity = {
		"read /root/extensions/activity.ts": "activity\n",
		"stat /root/extensions/activity.ts": {
			size: 9,
			mtime: new Date(0),
			dir: false,
		},
	};
	const pi = fakeIo(sources(activity));
	const claude = fakeIo(sources(activity), SEATS.claude);

	for (const io of [pi, claude]) {
		render(
			{ root: "/root", agent: io.seat!.name, seat: "host", out: "/home" },
			io,
		);
		render(
			{ root: "/root", agent: io.seat!.name, seat: "container", out: "/stage" },
			io,
		);
	}

	assert.equal(pi.files["/stage/home/agent/extensions/activity.ts"], "activity\n");
	assert.equal(claude.files["/stage/home/fleet/extensions/activity.ts"], "activity\n");
	for (const io of [pi, claude])
		assert.deepEqual(
			Object.keys(io.files).filter(
				(path) => path.startsWith("/home/") && path.endsWith("activity.ts"),
			),
			[],
		);
});

test("every container carries the default-branch push guard with the modules it imports, and no host does", () => {
	const guard: Record<string, unknown> = {};
	for (const file of [
		"extensions/container-guard.ts",
		"src/guard/container.ts",
		"src/guard/argv.ts",
		"src/guard/translate.ts",
	]) {
		guard[`read /root/${file}`] = `${file}\n`;
		guard[`stat /root/${file}`] = { size: 1, mtime: new Date(0), dir: false };
	}
	const pi = fakeIo(sources(guard));
	const claude = fakeIo(sources(guard), SEATS.claude);

	for (const io of [pi, claude]) {
		render(
			{ root: "/root", agent: io.seat!.name, seat: "host", out: "/home" },
			io,
		);
		render(
			{ root: "/root", agent: io.seat!.name, seat: "container", out: "/stage" },
			io,
		);
	}

	for (const file of [
		"extensions/container-guard.ts",
		"src/guard/container.ts",
		"src/guard/argv.ts",
		"src/guard/translate.ts",
	])
		assert.equal(pi.files[`/stage/home/agent/${file}`], `${file}\n`, file);
	for (const file of ["src/guard/container.ts", "src/guard/argv.ts"])
		assert.equal(claude.files[`/stage/home/fleet/${file}`], `${file}\n`, file);
	for (const io of [pi, claude])
		assert.deepEqual(
			Object.keys(io.files).filter(
				(path) =>
					path.startsWith("/home/") && /container-guard|guard\/container/.test(path),
			),
			[],
		);
});

test("pi folds the rules into one AGENTS.md and keeps host.md out of the container", () => {
	const io = fakeIo(sources());

	render({ root: "/root", agent: "pi", seat: "host", out: "/home" }, io);
	render({ root: "/root", agent: "pi", seat: "container", out: "/stage" }, io);

	assert.equal(
		io.files["/home/agent/AGENTS.md"],
		"# Core\nask with ask_user_question\n\n# Host\nrun fleet steer\n",
	);
	assert.equal(
		io.files["/stage/home/agent/AGENTS.md"],
		"# Core\nask with ask_user_question\n\n# Container\nleaves at fleet land\n",
	);
	assert.equal(
		io.files["/home/agent/agents/explorer.md"],
		"---\nname: explorer\ntools: read, grep\n---\n",
	);
});

test("claude keeps one file per rule, its own tool names and CLAUDE.md", () => {
	const io = fakeIo(sources(), SEATS.claude);

	render({ root: "/root", agent: "claude", seat: "host", out: "/home" }, io);
	render(
		{ root: "/root", agent: "claude", seat: "container", out: "/stage" },
		io,
	);

	assert.equal(
		io.files["/home/rules/core.md"],
		"# Core\nask with AskUserQuestion\n",
	);
	assert.equal(io.files["/home/rules/host.md"], "# Host\nrun fleet steer\n");
	assert.equal(
		io.files["/home/agents/explorer.md"],
		"---\nname: explorer\ntools: Read, Grep\n---\n",
	);
	assert.equal(io.files["/home/CLAUDE.md"], "Rules live in rules/.\n");
	assert.equal(
		io.files["/stage/home/rules/sandbox.md"],
		"# Container\nleaves at fleet land\n",
	);
	assert.equal(io.files["/stage/home/rules/host.md"], undefined);
});

test("both host seats name the wiki under the home of the Mac that renders", () => {
	for (const agent of ["pi", "claude"] as const) {
		const io = fakeIo(
			sources({ "read /root/rules/host.md": "wiki at {{wiki}}\n" }),
			SEATS[agent],
		);

		render({ root: "/root", agent, seat: "host", out: "/home" }, io);

		const rule =
			agent === "claude"
				? io.files["/home/rules/host.md"]
				: io.files["/home/agent/AGENTS.md"];
		assert.match(rule ?? "", /^wiki at \/home\/me\/my-knowledge-base$/m, agent);
	}
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
		SEATS.claude,
	);

	render({ root: "/root", agent: "claude", seat: "host", out: "/home" }, io);
	render(
		{ root: "/root", agent: "claude", seat: "container", out: "/stage" },
		io,
	);

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

test("a skill, rule or agent gone from the sources is gone from the home after the next render", () => {
	const io = fakeIo(sources(), SEATS.claude);
	io.files["/home/skills/retired/SKILL.md"] = "old";
	io.files["/home/rules/env.md"] = "old";
	io.files["/home/settings.json"] = "{}";

	render({ root: "/root", agent: "claude", seat: "host", out: "/home" }, io);

	assert.equal(io.files["/home/skills/retired/SKILL.md"], undefined);
	assert.equal(io.files["/home/rules/env.md"], undefined);
	assert.equal(io.files["/home/settings.json"], "{}");
	assert.equal(
		io.files["/home/rules/core.md"],
		"# Core\nask with AskUserQuestion\n",
	);
});

function renderSeats(
	name: keyof typeof KINDS,
	read: (out: string) => void,
): void {
	const out = mkdtempSync(join(tmpdir(), `render-${name}-`));
	try {
		const io = { ...realIo(out), log: () => {} };
		render({ root, agent: name, seat: "host", out: `${out}/host` }, io);
		render({ root, agent: name, seat: "container", out: `${out}/container` }, io);
		read(out);
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
}

test("pi host and container load no pi-lens, and the pi kit sets none of its variables", () => {
	renderSeats("pi", (out) => {
		const host = JSON.parse(
			readFileSync(`${out}/host/agent/settings.json`, "utf8"),
		);
		const sbx = JSON.parse(
			readFileSync(`${out}/container/context/agent-settings.json`, "utf8"),
		);

		assert.ok(host.packages.length > 0);
		assert.ok(sbx.packages.length > 0);
		assert.deepEqual(host.packages.filter((p: string) => p.includes("pi-lens")), []);
		assert.deepEqual(sbx.packages.filter((p: string) => p.includes("pi-lens")), []);
	});

	const kit = readFileSync(`${KINDS.pi.agentSpec(root)}/spec.yaml`, "utf8");

	assert.doesNotMatch(kit, /PI_LENS_/);
	assert.ok(!KINDS.pi.agentArgs.includes("--no-lens-context"));
});

function containerRules(out: string): string[] {
	return (
		readdirSync(`${out}/container`, { recursive: true }) as string[]
	).filter((file) =>
		/(^|\/)(AGENTS|CLAUDE)\.md$|\/rules\/[^/]+\.md$/.test(file),
	);
}

function rendered(out: string, seat: string, suffix: string): string {
	const file = (
		readdirSync(`${out}/${seat}`, { recursive: true }) as string[]
	).find((path) => path.endsWith(suffix));
	assert.ok(file, `${seat} has no ${suffix}`);
	return readFileSync(join(out, seat, file), "utf8");
}

function seatFiles(out: string, seat: string): string[] {
	return readdirSync(`${out}/${seat}`, { recursive: true }) as string[];
}

const containerSkills = readdirSync(join(root, "skills/container"))
	.filter((s) => existsSync(join(root, "skills/container", s, "SKILL.md")))
	.sort();

function description(skill: string): string {
	const text = readFileSync(join(root, "skills/container", skill, "SKILL.md"), "utf8");
	return text.match(/^description: '?(.*?)'?$/m)![1].replaceAll("''", "'");
}

for (const name of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
	test(`the ${name} reviewer reaches both seats`, () => {
		renderSeats(name, (out) => {
			for (const seat of ["host", "container"])
				assert.ok(seatFiles(out, seat).some((f) => f.endsWith("agents/reviewer.md")), `${seat} lacks agents/reviewer.md`);
		});
	});

	test(`the ${name} conflict procedure and pull request body reach only the container`, () => {
		renderSeats(name, (out) => {
			for (const suffix of ["resolving-merge-conflicts/SKILL.md", "/pr/SKILL.md"]) {
				assert.equal(seatFiles(out, "host").some((f) => f.endsWith(suffix)), false, `host has ${suffix}`);
				assert.ok(seatFiles(out, "container").some((f) => f.endsWith(suffix)), `container lacks ${suffix}`);
			}
		});
	});

	test(`the ${name} host reads what a container can deliver, one description per container skill`, () => {
		renderSeats(name, (out) => {
			const map = rendered(out, "host", "orchestrating-agent-sessions/references/outcomes.md");

			const lines = map.split("\n").filter((l) => l.startsWith("- "));

			assert.deepEqual(lines, containerSkills.map((s) => `- ${description(s)}`));
			assert.equal(seatFiles(out, "container").some((f) => f.endsWith("outcomes.md")), false);
		});
	});

	test(`${name} renders both seats from the real sources with every token resolved`, () => {
		renderSeats(name, (out) => {
			const leftovers = (readdirSync(out, { recursive: true }) as string[])
				.filter((file) => file.endsWith(".md"))
				.filter((file) => /\{\{[a-z]/.test(readFileSync(join(out, file), "utf8")));
			assert.deepEqual(leftovers, []);
			for (const seat of ["host", "container"]) {
				const core = rendered(
					out,
					seat,
					name === "claude" ? "rules/core.md" : "AGENTS.md",
				);
				assert.equal(
					core.split("Wrong expectation -> stop, quote spec or ask user.").length -
						1,
					1,
				);
			}
		});
	});
}

test("the stock continue names no session rule", () => {
	assert.equal(CONTINUE, "Continue the task from where it stopped.");
});

for (const name of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
	test(`${name} starts every ticket, the final verification and every PR round in a fresh session`, () => {
		renderSeats(name, (out) => {
			const rules = rendered(out, "container", name === "claude" ? "rules/sandbox.md" : "AGENTS.md");

			assert.match(rules, /Every ticket, the final verification and every pull request round start in a fresh session, with one line naming the ticket or the step/);
			assert.match(rules, /Read that file, `spec\.md` when it exists, and `git log`/);
		});
	});

	test(`${name} updates the branch once, by the merge method the project names, as a git command decides`, () => {
		renderSeats(name, (out) => {
			const rules = rendered(out, "container", name === "claude" ? "rules/sandbox.md" : "AGENTS.md");
			const finish = rules.split("## Finish\n")[1]!;

			assert.match(finish, /`git merge-base --is-ancestor origin\/<base> HEAD` exiting 0 means no update/);
			assert.match(finish, /by the method `## Merge method` in `project\.md` names/);
			assert.match(rules, /\| Branch update, by the method `## Merge method` in `project\.md` names \| before the final checks \| 1, never repeated by a later session \|/);
		});
	});

	test(`${name} renders no Next step`, () => {
		renderSeats(name, (out) => {
			const naming = (readdirSync(out, { recursive: true }) as string[])
				.filter((file) => file.endsWith(".md"))
				.filter((file) =>
					readFileSync(join(out, file), "utf8").includes("Next step"),
				);
			assert.deepEqual(naming, []);
		});
	});
}

for (const name of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
	test(`${name} gives both seats the CI ref, and the skills that read CI point at it without a copy`, () => {
		renderSeats(name, (out) => {
			const pointer = KINDS[name].tokens["refs.ci"]!;

			const refs = [
				rendered(out, "host", "refs/ci.md"),
				rendered(out, "container", "refs/ci.md"),
			];
			const skills = [
				rendered(out, "host", "orchestrating-agent-sessions/SKILL.md"),
				rendered(out, "container", "babysit-pr/SKILL.md"),
			];

			for (const ref of refs) {
				assert.ok(
					ref.includes("gh run list --commit <sha> --json status,conclusion,name"),
					"ref names the CI read",
				);
				assert.ok(
					ref.includes("gh pr view <n> --json headRefOid"),
					"ref names where the full SHA comes from",
				);
			}
			for (const skill of skills) {
				assert.ok(skill.includes(pointer), "skill points at the CI ref");
				assert.doesNotMatch(
					skill,
					/statusCheckRollup|check runs|gh pr checks|Checks permission|--json headRefOid/,
				);
			}
		});
	});
}

for (const name of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
	test(`${name} gives both seats the one ticket template, and to-tickets and the host point at it without a copy`, () => {
		renderSeats(name, (out) => {
			const pointer = KINDS[name].tokens["refs.ticket"]!;

			for (const seat of ["host", "container"])
				assert.equal(
					rendered(out, seat, "refs/ticket.md"),
					readFileSync(join(root, "rules/refs/ticket.md"), "utf8"),
				);
			for (const skill of [
				rendered(out, "host", "orchestrating-agent-sessions/SKILL.md"),
				rendered(out, "container", "to-tickets/SKILL.md"),
			]) {
				assert.ok(skill.includes(pointer), "skill points at the ticket template");
				assert.doesNotMatch(skill, /<ticket-template>|## Acceptance criteria/);
			}
			assert.ok(
				rendered(out, "container", "to-tickets/SKILL.md").includes(
					"`spec/ticket.md`",
				),
				"to-tickets names the project's own template first",
			);
		});
	});
}

for (const name of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
	test(`${name} ticket template holds out of scope and open questions slots, a title rule and a boundary criterion`, () => {
		renderSeats(name, (out) => {
			const ticket = rendered(out, "container", "refs/ticket.md");

			assert.match(ticket, /^## Out of scope\n\n- .+, or "None"\.$/m);
			assert.doesNotMatch(ticket, /Out of scope headings only when/);
			assert.match(ticket, /^## Open questions\n\n- <.+> -> <.+>, or "None"\.$/m);
			assert.match(
				ticket,
				/^The title states the change in a few words, imperative, the way it reads on a board: ".+", never the symptom\.$/m,
			);
			assert.match(
				ticket,
				/^- \[ \] <Boundary case: .+> -> <observable outcome with its concrete value>\.$/m,
			);
			assert.match(
				ticket,
				/^Each criterion is an invariant whose expected result comes from the ticket, not from the current code\. Write it in the ticket's language, in the form that reads clearest, Given\/When\/Then, an example input with its result, or a rule with its value, and spend the lines on boundary cases/m,
			);
		});
	});
}

for (const name of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
	test(`${name} gives both seats the design ref, and the rules and mockup point at it without a copy`, () => {
		renderSeats(name, (out) => {
			const pointer = KINDS[name].tokens["refs.design"]!;
			const rules = name === "pi" ? "AGENTS.md" : "rules/core.md";

			for (const seat of ["host", "container"]) {
				assert.equal(
					rendered(out, seat, "refs/design.md"),
					readFileSync(join(root, "rules/refs/design.md"), "utf8"),
				);
				assert.ok(rendered(out, seat, rules).includes(pointer), "rules point at the design ref");
			}
			assert.ok(
				rendered(out, "container", "mockup/SKILL.md").includes(pointer),
				"mockup points at the design ref",
			);
		});
	});
}

for (const name of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
	test(`${name} tells the host which ticket of a wave goes up first, and no seat holds a natural-break table`, () => {
		renderSeats(name, (out) => {
			assert.match(
				rendered(out, "host", "orchestrating-agent-sessions/SKILL.md"),
				/within a wave the ticket the most open tickets wait on goes up first/,
			);
			for (const seat of ["host", "container"]) {
				const tables = (readdirSync(`${out}/${seat}`, { recursive: true }) as string[])
					.filter((file) => file.endsWith(".md"))
					.filter((file) => readFileSync(join(out, seat, file), "utf8").includes("| Natural break |"));
				assert.deepEqual(tables, [], `${seat} still has a natural-break table`);
			}
		});
	});
}

for (const name of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
	test(`${name} seats branch on no permission level; the profile's description holds each level's sentence`, () => {
		renderSeats(name, (out) => {
			const branches = (readdirSync(out, { recursive: true }) as string[])
				.filter((file) => file.endsWith(".md"))
				.flatMap((file) =>
					readFileSync(join(out, file), "utf8")
						.split("\n")
						.map((line) => `${file}: ${line}`),
				)
				.filter(
					(line) =>
						/`(auto|human|none|read|write)`/.test(line) &&
						/\b(push|pr|pull request|merge|sign|linear)\b/i.test(line),
				)
				.filter((line) => !line.includes("the level your permissions give"));
			assert.deepEqual(branches, []);
			assert.match(
				rendered(out, "host", "orchestrating-agent-sessions/SKILL.md"),
				/order the plan so the checks that judge a merge exist before the first change they judge, and the widest parallel wave starts as early as possible/i,
			);
			assert.doesNotMatch(
				rendered(out, "host", "orchestrating-agent-sessions/SKILL.md"),
				/skeleton with CI/,
			);
		});
	});
}

test("the claude host watches the containers its own pane put up or steered last", () => {
	renderSeats("claude", (out) => {
		const rules = (readdirSync(`${out}/host`, { recursive: true }) as string[])
			.filter((file) => file.endsWith(".md"))
			.map((file) => readFileSync(join(out, "host", file), "utf8"))
			.join("\n");

		assert.match(
			rules,
			/the fleet mod holds `fleet watch` for the session's life, following the containers whose latest `fleet up` or `fleet steer` came from this pane/,
		);
		assert.doesNotMatch(rules, /Monitor/);
		assert.doesNotMatch(rules, /watches every `claude-` container/);
	});
});

test("the claude container turns the feedback survey off, so no survey sits in the input a steer types into", () => {
	renderSeats("claude", (out) => {
		const settings = JSON.parse(
			readFileSync(`${out}/container/context/settings.json`, "utf8"),
		);

		assert.equal(settings.env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY, "1");
	});
});

test("a host Linear server any profile names leaves pi's machine-wide mcp.json, and the servers beside it stay", () => {
	const context7 = { url: "https://mcp.context7.com/mcp" };
	const profiles = {
		"read /home/me/.fleet/config/repos.json": JSON.stringify({
			[PRIVATE_REPO]: PRIVATE_PROFILE,
		}),
		"read /home/agent/mcp.json": JSON.stringify({
			mcpServers: {
				context7,
				"linear-private": { url: "https://mcp.linear.app/mcp", auth: "oauth" },
			},
		}),
		"read /root/pi/profiles/host.json": JSON.stringify({
			packages: ["npm:pi-subagents@0.73.1"],
		}),
		"read /root/pi/profiles/sbx.json": JSON.stringify({
			packages: ["npm:pi-subagents@0.73.1", "npm:pi-mcp-adapter@2.32.0"],
		}),
	};
	const pi = fakeIo(sources(profiles));

	render({ root: "/root", agent: "pi", seat: "host", out: "/home" }, pi);

	assert.deepEqual(JSON.parse(pi.files["/home/agent/mcp.json"]).mcpServers, {
		context7,
	});
	assert.deepEqual(JSON.parse(pi.files["/home/agent/settings.json"]).packages, [
		"npm:pi-subagents@0.73.1",
	]);
	assert.equal(JSON.parse(pi.files["/home/agent/settings.json"]).extensions, undefined);
});

test("with no host Linear server in any profile, the host render writes no mcp.json", () => {
	const silent = Object.fromEntries(
		Object.entries(JSON.parse(WITH_PRIVATE)).map(
			([match, entry]: [string, any]) => [
				match,
				{
					...entry,
					host: { ...entry.host, linear: "none", linearServer: undefined },
				},
			],
		),
	);
	const profiles = { "read /root/host/repos.json": JSON.stringify(silent) };
	const pi = fakeIo(
		sources({
			...profiles,
			"read /root/pi/profiles/host.json": JSON.stringify({
				packages: ["npm:pi-subagents@0.73.1"],
			}),
		}),
	);

	render({ root: "/root", agent: "pi", seat: "host", out: "/home" }, pi);

	assert.equal(pi.files["/home/agent/mcp.json"], undefined);
	assert.deepEqual(JSON.parse(pi.files["/home/agent/settings.json"]).packages, [
		"npm:pi-subagents@0.73.1",
	]);
});

for (const name of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
	test(`${name} plans a per-ticket review by blast radius, reviews the whole branch once, and the image carries no ticket check`, () => {
		renderSeats(name, (out) => {
			const promises = (readdirSync(out, { recursive: true }) as string[])
				.filter((file) => file.endsWith(".md"))
				.flatMap((file) =>
					readFileSync(join(out, file), "utf8")
						.split("\n")
						.map((line) => `${file}: ${line}`),
				)
				.filter((line) =>
					/(?<!at most )one review per ticket|one review and one commit|review of its uncommitted diff before its one commit|the reviewed work|and its review before the commit|when a review of the task names a shared seam|reviewer sub-agent already reviews/i.test(
						line,
					),
				);
			assert.deepEqual(promises, []);
			assert.match(
				rendered(out, "container", "to-tickets/SKILL.md"),
				/carries the line `Review: after this ticket`, written now/,
			);
			assert.match(
				rendered(out, "container", "implement/SKILL.md"),
				/runs when the ticket carries `Review: after this ticket` or the order asks for one/,
			);
			const rules = containerRules(out)
				.map((file) => readFileSync(join(out, "container", file), "utf8"))
				.join("\n");
			assert.match(rules, /\| Independent review of the whole branch, `two-axis-review` \| after the last ticket's commit, before the final checks \| 1 \|/);
			assert.match(
				rendered(out, "host", "orchestrating-agent-sessions/SKILL.md"),
				/gets `Review: after this ticket` in its description before the container starts it/,
			);
			assert.doesNotMatch(rendered(out, "container", "context/Dockerfile"), /ticket-check/);
			assert.match(
				rendered(out, "container", "context/Dockerfile"),
				/container\/ci-wait\.sh\s+\/usr\/local\/bin\/ci-wait/,
			);
			assert.ok(
				rendered(out, "container", "context/container/ci-wait.sh").includes("headRefOid"),
			);
		});
	});
}

for (const name of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
	test(`${name} verifies what a user sees the way project.md names, with no browser in the container rules`, () => {
		renderSeats(name, (out) => {
			const files = (readdirSync(out, { recursive: true }) as string[]).filter(
				(file) => file.endsWith(".md") && !file.endsWith("references/outcomes.md"),
			);
			const rules = containerRules(out);
			assert.ok(rules.length > 0);
			for (const file of rules)
				assert.doesNotMatch(
					readFileSync(join(out, "container", file), "utf8"),
					/browser/i,
					file,
				);
			const triggers = files
				.flatMap((file) =>
					readFileSync(join(out, file), "utf8")
						.split("\n")
						.map((line) => `${file}: ${line}`),
				)
				.filter((line) =>
					/changes a shared seam|`check-regressions` (runs|follows)/.test(line),
				);
			assert.equal(triggers.length, 1, triggers.join("\n"));
			assert.match(triggers[0]!, /check-regressions\/SKILL\.md: description:/);
			assert.doesNotMatch(
				rendered(out, "container", "refs/ticket.md"),
				/Seen:|## Parent/,
			);
			assert.doesNotMatch(
				rendered(out, "container", "implement/SKILL.md"),
				/Seen:/,
			);
			assert.doesNotMatch(
				rendered(
					out,
					"container",
					name === "claude" ? "rules/sandbox.md" : "AGENTS.md",
				),
				/Seen:/,
			);
			assert.match(
				rendered(out, "container", "check-feature/SKILL.md"),
				/screenshot read against it/,
			);
			assert.match(
				rendered(out, "container", "refs/artifacts.md"),
				/a list of frames, one line each with the criterion and verdict/,
			);
		});
	});
}

for (const name of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
	test(`${name} container checkpoints, ends every turn on the closing message and cuts small tickets`, () => {
		renderSeats(name, (out) => {
			const implement = rendered(out, "container", "implement/SKILL.md");
			assert.match(
				implement,
				/Commit the first coherent vertical piece before widening/,
			);
			assert.match(
				implement,
				/In a short run, or on an order naming this one ticket, the rest stays in this ticket/,
			);
			assert.match(
				implement,
				/name the acceptance line most likely to be false and make the check that would catch it the first red of step 5/,
			);
			const rules = containerRules(out)
				.map((file) => readFileSync(join(out, "container", file), "utf8"))
				.join("\n");
			assert.match(
				rules,
				/A question for the host goes into `Question:` of the closing message, and the turn ends there\. Never a `\w+` dialog here/,
			);
			assert.ok(
				rules.includes(
					"Every turn ends with this message, whatever the turn did:\n\n```text\nChanges: <what changed>\nChecks: <command> -> exit <n> @ <sha7>, <log path under logs/>\nCommits: <sha7> <subject>\nQuestion: <a question for a person, or none>\n```",
				),
			);
			for (const row of [
				"| Red test | before the code of each behaviour | 1 per behaviour |",
				"| Ticket tests (changed files and their importers) | after the ticket's code | 1 per ticket, plus reruns while fixing |",
				"| Review fixes | one batch, each with its own test | 1 |",
				"| Typecheck and lint of changed files | final tree | 1 |",
				"| Tests of affected packages | final tree; on the base only the files that failed | 1 |",
			])
				assert.ok(rules.includes(row), row);
			assert.match(rules, /each check covers only the base or the last `@sha` it passed on, up to HEAD/);
			assert.match(rules, /Gates run with no bash timeout/);
			assert.match(
				rendered(out, "container", "to-tickets/SKILL.md"),
				/Cut small, so each commit reads as one change: one behaviour per ticket, still a complete path through every layer/,
			);
			const ticket = rendered(out, "container", "refs/ticket.md");
			assert.match(
				ticket,
				/progress lives in the tracker and in git\. A local copy's `Status:` is the host's; the container leaves it as it is and ticks each criterion with its evidence/,
			);
			assert.doesNotMatch(ticket, /\d/);
		});
	});
}

for (const name of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
	test(`${name} allows exactly the read-only roles installed on each seat`, () => {
		renderSeats(name, (out) => {
			for (const seat of ["host", "container"]) {
				const rules = name === "pi"
					? rendered(out, seat, "AGENTS.md")
					: rendered(out, seat, "rules/delegation.md") + (seat === "container" ? rendered(out, seat, "rules/sandbox.md") : "");
				const allowance = rules.split("\n").filter((line) => /^Shared roles, all read-only:/.test(line)).join("\n");
				const allowed = [...allowance.matchAll(/`(explorer|researcher|reviewer)`/g)].map((match) => match[1]).sort();
				const installed = seatFiles(out, seat).flatMap((file) => file.match(/(?:^|\/)agents\/([^/]+)\.md$/)?.[1] ?? []).sort();

				assert.deepEqual(allowed, installed, `${name} ${seat}`);
			}
		});
	});

	test(`${name} keeps the prose catalogue behind a pointer on both seats`, () => {
		renderSeats(name, (out) => {
			for (const seat of ["host", "container"]) {
				const always = seatFiles(out, seat)
					.filter((file) => file.endsWith("AGENTS.md") || /(^|\/)rules\/[^/]+\.md$/.test(file))
					.map((file) => readFileSync(join(out, seat, file), "utf8"))
					.join("\n");
				const ref = rendered(out, seat, "refs/prose.md");

				assert.doesNotMatch(always, /Patterns to detect and fix/, `${seat} always loads the catalogue`);
				assert.match(always, /refs\/prose\.md/, `${seat} has no pointer to the catalogue`);
				assert.match(ref, /Patterns to detect and fix/);
			}
		});
	});

	test(`${name} reviewer separates completed review from required fixes and task readiness`, () => {
		renderSeats(name, (out) => {
			const reviewer = rendered(out, "container", "agents/reviewer.md");
			assert.match(reviewer, /Review: complete \| incomplete/);
			assert.match(reviewer, /Required fixes: yes \| no/);
			assert.match(reviewer, /proven P0 or P1/);
			assert.match(reviewer, /Neither field declares the task ready/);
			assert.match(reviewer, /proven \| plausible \| unverified/);
			assert.doesNotMatch(reviewer, /PASS <head-sha>|FAIL <head-sha>/);
			const skill = rendered(out, "container", "two-axis-review/SKILL.md");
			assert.equal(rendered(out, "host", "two-axis-review/SKILL.md"), skill);
			assert.match(skill, /Axis 1: correctness and fulfillment/);
			assert.match(skill, /Axis 2: engineering quality/);
			if (name === "pi") {
				assert.match(skill, /`async: true`/);
				assert.match(skill, /Leave the working tree untouched until `review\.md` arrives/);
				assert.doesNotMatch(skill, /`async: false`/);
			}
		});
	});
}

for (const name of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
	test(`${name} records a decision a later change could undo as an ADR, on both seats`, () => {
		renderSeats(name, (out) => {
			for (const seat of ["host", "container"] as const) {
				const core = rendered(
					out,
					seat,
					name === "claude" ? "rules/core.md" : "AGENTS.md",
				);
				assert.match(
					core,
					/A decision a later change could undo unknowingly becomes an ADR in `docs\/adr\/`, in the format the ADRs there use\. A ticket's own decisions go into its issue/,
				);
			}
			assert.match(
				rendered(out, "host", "orchestrating-agent-sessions/SKILL.md"),
				/Write the ADR a decision of yours needs in `docs\/adr\/`/,
			);
			assert.match(
				rendered(
					out,
					"container",
					name === "claude" ? "rules/sandbox.md" : "AGENTS.md",
				),
				/An ADR the run's decisions need is proposed in its pull request, as a commit adding it under `docs\/adr\/`/,
			);
		});
	});
}

for (const name of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
	test(`${name} babysit-pr records one bounded CI round through its shell adapter`, () => {
		renderSeats(name, (out) => {
			const skill = rendered(out, "container", "babysit-pr/SKILL.md");
			if (name === "claude") assert.match(skill, /`run_in_background: true`/);
			else assert.doesNotMatch(skill, /third argument|one read per tool call|Repeat the call/);
			assert.match(skill, /The wait ends by recording the settled state/);
			assert.match(
				rendered(out, "container", name === "claude" ? "rules/sandbox.md" : "AGENTS.md"),
				/`Checks:` repeats per check; `@ <sha7>` is the commit the check passed on/,
			);
			const core = rendered(
				out,
				"container",
				name === "claude" ? "rules/core.md" : "AGENTS.md",
			);
			assert.match(
				core,
				/A poll loop is not work\. A bounded wait on an external system, such as CI, is work: run it the way its skill says/,
			);
		});
	});
}

for (const name of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
	test(`${name} host accepts on evidence it looked at, merges the overlay's way and keeps the plan in the tracker`, () => {
		renderSeats(name, (out) => {
			const skill = rendered(out, "host", "orchestrating-agent-sessions/SKILL.md");
			assert.doesNotMatch(
				skill,
				/--squash|spec\/|\b(Backlog|Todo|In Progress|In Review|Done|Canceled)\b/,
			);
			assert.match(
				skill,
				/read their names from the tracker's workflow for that team/,
			);
			assert.match(
				skill,
				/Whether a change earns an independent review is yours, by risk class/,
			);
			assert.match(skill, /yourself with skill `two-axis-review` over the container's range/);
			assert.match(skill, /independent review of <base>\.\.\.<head>, ending in `review\.md` with its evidence/);
			assert.doesNotMatch(skill, /review[^.\n]*with (your own )?`?explorer/i);
			assert.match(
				skill,
				/Before a wave starts, settle once what its tickets will share/,
			);
			assert.match(skill, /check which running ticket owns that area/);
			assert.match(skill, /resident memory measured per container/);
			assert.match(
				skill,
				/becomes a not-started issue with the tracker's own priority and the project's own labels/,
			);
			assert.match(skill, /the full 40-character SHA read in the same turn/);
			assert.match(skill, /reaches the user in your next reply/);
			assert.doesNotMatch(skill, /[Ss]tanding decisions|slug \(who, date\)/);
			assert.match(skill, /The host checkout stays on the default branch/);
			assert.match(skill, /resumes from the tracker and `[a-z]+ ls`/);
			assert.match(
				skill,
				/tick in the issue each criterion you checked and comment the evidence you looked at beside it/,
			);
			assert.doesNotMatch(skill, /acceptance\.md|cannot read or write/);
			assert.match(
				skill,
				/One stopped by the account limit is resumed by the watch with the stock continue/,
			);
			assert.match(skill, /keeps running while the session waits out an account limit/);
			assert.match(skill, /one fix round and one recheck/);
			assert.match(skill, /carries your stop rule/);
			assert.match(
				skill,
				/measure, make one fix, measure again, then end the turn with both numbers in the closing message's `Question:`/,
			);
			assert.match(
				skill,
				/one ticket per module or per group of related findings/,
			);
			assert.match(skill, /reconcile the tracker with the facts/);
			assert.match(skill, /`ticket\.md`/);
			assert.match(skill, /--merge --match-head-commit/);
			const rules = rendered(
				out,
				"host",
				name === "claude" ? "rules/host.md" : "AGENTS.md",
			);
			assert.match(
				rules,
				/moves past a merge that changed a lockfile, tell the user to run the project's install before running anything from this checkout, naming the command; you do not run it/,
			);
			const refs = rendered(out, "host", "refs/artifacts.md");
			assert.doesNotMatch(refs, /acceptance\.md/);
			assert.match(refs, /^ticket\.md /m);
		});
	});
}

for (const name of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
	test(`${name} updates a pull request body through the REST API and reads colours from computed styles`, () => {
		renderSeats(name, (out) => {
			assert.ok(
				rendered(out, "container", "babysit-pr/SKILL.md").includes(
					"gh api -X PATCH repos/<owner>/<repo>/pulls/<number> -F body=@<file>",
				),
			);
			assert.match(
				rendered(out, "container", "check-feature/SKILL.md"),
				/`getComputedStyle`/,
			);
		});
	});
}

const AGENT_NAME = /(?<![.\w/-])(pi|claude)(?![\w/-])/i;

function agentNaming(text: string): string[] {
	return text
		.split("\n")
		.filter(
			(line) =>
				AGENT_NAME.test(line.replaceAll("--pi|--claude", "")) &&
				!/\bbuild\b/.test(line),
		);
}

for (const name of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
	test(`the ${name} host seat's rules, fleet skill and its fragments name no container agent`, () => {
		const out = mkdtempSync(join(tmpdir(), `render-${name}-`));
		const seen = new Map<string, string>();
		try {
			render(
				{ root, agent: name, seat: "host", out, seen },
				{ ...realIo(out), log: () => {} },
			);
		} finally {
			rmSync(out, { recursive: true, force: true });
		}
		const texts = [...seen].filter(
			([path]) =>
				path === "rules/host.md" ||
				path.includes("orchestrating-agent-sessions/") ||
				/(^|\/)fragments\/(session-handoff|watching|natural-breaks)\.md$/.test(
					path,
				),
		);
		assert.ok(texts.length >= 4, texts.map(([path]) => path).join(", "));
		assert.deepEqual(
			texts.flatMap(([path, text]) =>
				agentNaming(text).map((line) => `${path}: ${line.slice(0, 90)}`),
			),
			[],
		);
	});
}

const compaction = JSON.parse(readFileSync(join(root, "src/compaction.json"), "utf8"));

test("claude host and container compact on their own at the one compaction point, and the container asks fable for advice", () => {
	const host = JSON.parse(readFileSync(join(root, "claude/profiles/host.json"), "utf8"));
	renderSeats("claude", (out) => {
		const container = JSON.parse(rendered(out, "container", "context/settings.json"));

		assert.equal(compaction.tokens, 400_000);
		assert.equal(host.autoCompactEnabled, true);
		assert.equal(host.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "{{compaction.tokens}}");
		assert.equal(container.autoCompactEnabled, true);
		assert.equal(container.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "400000");
		assert.equal(container.advisorModel, "claude-fable-5-1");
		assert.ok(rendered(out, "container", "home/fleet/src/compaction.json"));
	});
});

test("pi knows a 1M window for every codex model its seats use, and both seats compact at about 400k tokens", () => {
	renderSeats("pi", (out) => {
		for (const [seat, models, settings] of [
			["host", "agent/models.json", "agent/settings.json"],
			["container", "home/agent/models.json", "context/agent-settings.json"],
		]) {
			const overrides = JSON.parse(rendered(out, seat, models)).providers["openai-codex"].modelOverrides;
			for (const model of ["gpt-6-astra", "gpt-6-sol", "gpt-6.1-sol", "gpt-6-luna"])
				assert.equal(overrides[model]?.contextWindow, compaction.window, `${seat} ${model}`);
			const { compaction: compacts } = JSON.parse(rendered(out, seat, settings));
			assert.equal(compacts.enabled, true, seat);
			assert.ok(Math.abs(1_000_000 - compacts.reserveTokens - 400_000) <= 10_000, `${seat} compacts at ${1_000_000 - compacts.reserveTokens}`);
		}
		assert.ok(rendered(out, "container", "home/agent/src/compaction.json"));
	});
});
