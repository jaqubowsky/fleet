export type HarnessName = "pi" | "omp" | "claude";

export type Harness = {
	name: HarnessName;
	cli: string;
	home: string;
	prefix: string;
	agent: string;
	image: string;
	owner: "session" | "pane" | "none";
	sessionIdEnv?: string;
	sbxFlags: string[];
	env: string[];
	agentSpec(root: string): string;
	agentArgs: string[];
	resume: string;
	sessionEnv?: string;
	herdrIntegration?: string;
	codex?: { auth: string; kit: string };
	projectConfig?: string;
	sbxGuidance?: string;
	containerSessions?: string;
	cache: string;
	deliverAs?: "followUp" | "nextTurn";
	tokens: Record<string, string>;
};

const REFS_BESIDE_AGENTS = "`refs/artifacts.md` beside `AGENTS.md`";
const TESTING_BESIDE_AGENTS = "`refs/testing.md` beside `AGENTS.md`";
const PI_WATCH = "Steer returns at once and puts the container under watch; the `[fleet]` wake is where the outcome lands.";
const watchOwner = (agent: string, cli: string, env: string) => `Only the ${agent} session that ran \`${cli} up\` or \`${cli} steer\` auto-watches that container: the fleet monitor puts the session ID in \`${env}\` on every \`${cli}\` command the session runs, and the event carries it. Resuming that same session restores its watches. Ownerless events never auto-watch.`;
const CONTINUE = "Continue the previous task: read current durable artifacts and follow Next step in status.md.";
const continueInOneSteer = (cli: string) => `For an end-to-end task, approve and continue in one steer: \`${cli} steer <sandbox> "/session-handoff ${CONTINUE}"\`.`;

export const HARNESSES: Record<HarnessName, Harness> = {
	pi: {
		name: "pi",
		cli: "fleet",
		home: ".pi",
		prefix: "pi-",
		agent: "pi",
		image: "my-pi:v1",
		owner: "session",
		sessionIdEnv: "PI_SESSION_ID",
		sbxFlags: ["--skills=off"],
		env: [],
		agentSpec: (root) => `${root}/pi/kits/pi`,
		agentArgs: ["--approve", "--no-autoformat", "--no-lens-context"],
		resume: "-c",
		sessionEnv: "PI_CODING_AGENT_SESSION_DIR",
		herdrIntegration: "agent/extensions/herdr-agent-state.ts",
		codex: { auth: "agent/auth.json", kit: "pi" },
		cache: "cache",
		deliverAs: "followUp",
		tokens: {
			"tool.ask": "ask_user_question",
			"skill.ingest": "/skill:ingest",
			refs: REFS_BESIDE_AGENTS,
			"refs.testing": TESTING_BESIDE_AGENTS,
			watch: PI_WATCH,
			"review.saver": "the runtime",
			"steer.result": "steered; pi takes it after its current tool call, and the container is under watch from now on",
			"watch.owner": watchOwner("Pi", "fleet", "PI_SESSION_ID"),
			"delegation.parallel": "\"Parallel\" = several `explorer` or `researcher` runs started in the same turn, in the background, results collected before any synthesis",
			"model.flag": "<provider/id:thinking>",
			"models.row": "| switch models for new containers | `fleet render` after editing `pi/profiles/models.json` in the harness repo, or `--model` on one `fleet up` | files rewritten; host sees it after `/reload`, containers after `fleet build` |",
			"handoff.command": "/session-handoff",
			"handoff.continue": continueInOneSteer("fleet"),
		},
	},
	omp: {
		name: "omp",
		cli: "ofleet",
		home: ".omp",
		prefix: "omp-",
		agent: "omp",
		image: "my-omp:v1",
		owner: "session",
		sessionIdEnv: "OMP_SESSION_ID",
		sbxFlags: ["--skills=off"],
		env: [],
		agentSpec: (root) => `${root}/omp/kits/omp`,
		agentArgs: ["--yolo"],
		resume: "-c",
		sessionEnv: "PI_CODING_AGENT_SESSION_DIR",
		herdrIntegration: "agent/extensions/herdr-omp-agent-state.ts",
		codex: { auth: "agent/auth.json", kit: "omp" },
		cache: "cache",
		deliverAs: "nextTurn",
		tokens: {
			"tool.ask": "ask",
			"skill.ingest": "/skill:ingest",
			refs: REFS_BESIDE_AGENTS,
			"refs.testing": TESTING_BESIDE_AGENTS,
			watch: PI_WATCH,
			"review.saver": "the runtime",
			"steer.result": "steered; omp takes it after its current tool call, and the container is under watch from now on",
			"watch.owner": watchOwner("OMP", "ofleet", "OMP_SESSION_ID"),
			"delegation.parallel": "\"Parallel\" = one `task` batch holding several independent `explorer` or `researcher` items, started together, results collected before any synthesis",
			"model.flag": "<provider/id:thinking>",
			"models.row": "| switch models for new containers | `ofleet render` after editing `omp/profiles/models.json` in the harness repo, or `--model` on one `ofleet up` | files rewritten; host sees it after `/reload`, containers after `ofleet build` |",
			"handoff.command": "/session-handoff",
			"handoff.continue": continueInOneSteer("ofleet"),
		},
	},
	claude: {
		name: "claude",
		cli: "cfleet",
		home: ".claude",
		prefix: "claude-",
		agent: "claude",
		image: "my-claude:v1",
		owner: "none",
		sbxFlags: ["-t", "my-claude:v1", "--skills=off"],
		env: ["FORCE_COLOR=3"],
		agentSpec: () => "claude",
		agentArgs: [],
		resume: "--continue",
		projectConfig: ".claude",
		sbxGuidance: "CLAUDE.md",
		containerSessions: "/home/agent/.claude/projects",
		cache: "fleet-cache",
		tokens: {
			"tool.ask": "AskUserQuestion",
			"skill.ingest": "/ingest",
			refs: "`~/.claude/refs/artifacts.md`",
			"refs.testing": "`~/.claude/refs/testing.md`",
			watch: "Steer returns at once; the `[fleet]` wake is where the outcome lands, and it reaches you only through `cfleet watch` held with `Monitor` at `timeout_ms: 1800000`: start it before the first steer, one per session, and re-arm it at its expiry notice.",
			"review.saver": "the calling session",
			"steer.result": "steered; claude takes it as its next message, and `cfleet watch` reports how it settles",
			"delegation.parallel": "\"Parallel\" = several `Agent` calls with `subagent_type` `explorer` or `researcher` in one message, each with `run_in_background: true`, results collected before any synthesis",
			"model.flag": "<opus|sonnet|model id>",
			"models.row": "| switch models for new containers | `cfleet render` then `cfleet build` after editing `claude/profiles/models.json` in the harness repo, or `--model` on one `cfleet up` | the image carries it; the host takes it from `align-settings.py --apply` |",
			"handoff.command": "/clear",
			"handoff.continue": `For an end-to-end task, follow the approval with a second steer: \`cfleet steer <sandbox> "${CONTINUE}"\`; \`/clear\` takes no text.`,
		},
	},
};

export function harness(name: string | undefined): Harness {
	const found = HARNESSES[(name ?? "pi") as HarnessName];
	if (!found) throw new Error(`no harness named ${name}; known: ${Object.keys(HARNESSES).join(", ")}`);
	return found;
}
