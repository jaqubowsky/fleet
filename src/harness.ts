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
const CI_BESIDE_AGENTS = "`refs/ci.md` beside `AGENTS.md`";
const TICKET_BESIDE_AGENTS = "`refs/ticket.md` beside `AGENTS.md`";
const pollCi = (agent: string) => `${agent} has no background shell, so change it to \`reads=1\`: one read per tool call, about a minute each, so a steer lands between calls. Repeat the call while it prints runs or status pending, up to twenty calls; the pane shows each read, and you keep the count.`;
const watchSource = (agent: string, cli: string, env: string) =>
	`Only the ${agent} session that ran \`${cli} up\` or \`${cli} steer\` auto-watches that container: the fleet monitor puts the session ID in \`${env}\` on every \`${cli}\` command the session runs, and the event carries it. Resuming that same session restores its watches, and the monitor keeps running while the session waits out an account limit. Ownerless events never auto-watch. \`fleet_watch <sandbox...>\`, or \`/fleet-watch [names]\` typed by the user, explicitly watches containers regardless of ownership, by the sandbox name \`${cli} ls\` prints; no name watches every container. A fleet wake is a follow-up turn after the current run settles, not context saved for the next user prompt.`;
const RELOAD_MODELS = "after `/reload`";
export const CONTINUE = "Continue the previous task: read current durable artifacts, then take the work from the frontier of issues/ and the last Log line in status.md.";
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
			"refs.ci": CI_BESIDE_AGENTS,
			"refs.ticket": TICKET_BESIDE_AGENTS,
			"steer.result": "steered; pi takes it after its current tool call, and the container is under watch from now on",
			"watch.source": watchSource("Pi", "fleet", "PI_SESSION_ID"),
			"reload.models": RELOAD_MODELS,
			"delegation.parallel": "\"Parallel\" = several `explorer` or `researcher` runs started in the same turn, in the background, results collected before any synthesis",
			"model.flag": "<provider/id:thinking>",
			"handoff.command": "/session-handoff",
			"handoff.continue": continueInOneSteer("fleet"),
			"ci.wait": pollCi("pi"),
			"review.call": "One `reviewer` call with `async: false`, so this turn waits for it, `output` set to the absolute path of `review.md`, `outputMode: \"file-only\"`.",
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
			"refs.ci": CI_BESIDE_AGENTS,
			"refs.ticket": TICKET_BESIDE_AGENTS,
			"steer.result": "steered; omp takes it after its current tool call, and the container is under watch from now on",
			"watch.source": watchSource("OMP", "ofleet", "OMP_SESSION_ID"),
			"reload.models": RELOAD_MODELS,
			"delegation.parallel": "\"Parallel\" = one `task` batch holding several independent `explorer` or `researcher` items, started together, results collected before any synthesis",
			"model.flag": "<provider/id:thinking>",
			"handoff.command": "/session-handoff",
			"handoff.continue": continueInOneSteer("ofleet"),
			"ci.wait": pollCi("omp"),
			"review.call": "One `reviewer` call, `output` set to the absolute path of `review.md`, `outputMode: \"file-only\"`.",
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
			"refs.ci": "`~/.claude/refs/ci.md`",
			"refs.ticket": "`~/.claude/refs/ticket.md`",
			"steer.result": "steered; claude takes it as its next message, and `cfleet watch` reports how it settles",
			"watch.source": "Nothing watches a container by itself here: Claude Code has no extension that can start a turn, so the wake is `cfleet watch`, held with `Monitor` at `timeout_ms: 1800000`, its maximum. Start it before the first steer and keep one Monitor per session; its expiry notice, and a notice that it stopped with an earlier session, is the re-arm, before anything else. With no names it follows the containers whose latest `cfleet up` or `cfleet steer` came from this herdr pane, drops one at its `cfleet down`, and picks up new ones within 30 seconds; names add those sandboxes beside them, whoever put them up. Its first line is `[fleet] watching ...`; a Monitor that never printed it never subscribed, so restart it. Before a long run, arm the limit resume as well: one more `cfleet watch` as a `Bash` call with `run_in_background: true`, which has no Monitor expiry, so it resumes containers the account limit stopped while that limit stops this session too.",
			"reload.models": "after `align-settings.py --apply`",
			"delegation.parallel": "\"Parallel\" = several `Agent` calls with `subagent_type` `explorer` or `researcher` in one message, each with `run_in_background: true`, results collected before any synthesis",
			"model.flag": "<opus|sonnet|model id>",
			"handoff.command": "/clear",
			"ci.wait": "Run it as one `Bash` call with `run_in_background: true`: the session stays steerable, and the loop's exit wakes you. Until then do what does not need CI, or end the turn.",
			"handoff.continue": `For an end-to-end task, follow the approval with a second steer: \`cfleet steer <sandbox> "${CONTINUE}"\`; \`/clear\` takes no text.`,
			"review.call": "One foreground `Agent` call with `subagent_type: \"reviewer\"`, so this turn waits for it; its final message is `review.md`, and you write it to the absolute path unchanged.",
		},
	},
};

export function harness(name: string | undefined): Harness {
	const found = HARNESSES[(name ?? "pi") as HarnessName];
	if (!found) throw new Error(`no harness named ${name}; known: ${Object.keys(HARNESSES).join(", ")}`);
	return found;
}
