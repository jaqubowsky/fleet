export type AgentName = "pi" | "claude";

export const CLI = "fleet";

export type Seat = {
	name: AgentName;
	owner: "session" | "pane";
	sessionIdEnv?: string;
};

export const SEATS: Record<AgentName, Seat> = {
	pi: { name: "pi", owner: "session", sessionIdEnv: "PI_SESSION_ID" },
	claude: { name: "claude", owner: "pane" },
};

export type Kind = {
	name: AgentName;
	home: string;
	prefix: string;
	image: string;
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
	handoffTakesText: boolean;
	tokens: Record<string, string>;
};

const REFS_BESIDE_AGENTS = "`refs/artifacts.md` beside `AGENTS.md`";
const CI_BESIDE_AGENTS = "`refs/ci.md` beside `AGENTS.md`";
const TICKET_BESIDE_AGENTS = "`refs/ticket.md` beside `AGENTS.md`";
const pollCi = (agent: string) =>
	`${agent} has no background shell, so change it to \`reads=1\`: one read per tool call, about a minute each, so a steer lands between calls. Repeat the call while it prints runs or status pending, up to twenty calls; the pane shows each read, and you keep the count.`;
const watchSource = (cli: string, env: string) =>
	`Only the session that ran \`${cli} up\` or \`${cli} steer\` auto-watches that container: the fleet monitor puts the session ID in \`${env}\` on every \`${cli}\` command the session runs, and the event carries it. Resuming that same session restores its watches, and the monitor keeps running while the session waits out an account limit. Ownerless events never auto-watch. \`fleet_watch <sandbox...>\`, or \`/fleet-watch [names]\` typed by the user, explicitly watches containers regardless of ownership, by the sandbox name \`${cli} ls\` prints; no name watches every container. A fleet wake is a follow-up turn after the current run settles, not context saved for the next user prompt.`;
const RELOAD_MODELS = "after `/reload`";
export const CONTINUE =
	"Continue the previous task: read the status.md header, Summary and recent Log turning points, then take the work from the frontier of issues/ and git. Read older Log entries only when the frontier needs them.";

export const KINDS: Record<AgentName, Kind> = {
	pi: {
		name: "pi",
		home: ".pi",
		prefix: "pi-",
		image: "my-pi:v1",
		sbxFlags: ["--skills=off"],
		env: [],
		agentSpec: (root) => `${root}/pi/kits/pi`,
		agentArgs: ["--approve", "--no-autoformat", "--no-lens-context"],
		resume: "-c",
		sessionEnv: "PI_CODING_AGENT_SESSION_DIR",
		herdrIntegration: "agent/extensions/herdr-agent-state.ts",
		codex: { auth: "agent/auth.json", kit: "pi" },
		cache: "cache",
		handoffTakesText: true,
		tokens: {
			"tool.ask": "ask_user_question",
			"skill.ingest": "/skill:ingest",
			refs: REFS_BESIDE_AGENTS,
			"refs.ci": CI_BESIDE_AGENTS,
			"refs.ticket": TICKET_BESIDE_AGENTS,
			"steer.result":
				"steered; the container takes it after its current step, and it is under watch from now on",
			"watch.source": watchSource("fleet", "PI_SESSION_ID"),
			"reload.models": RELOAD_MODELS,
			"delegation.parallel":
				'"Parallel" = several `explorer` or `researcher` runs started in the same turn, in the background, results collected before any synthesis',
			"handoff.command": "/session-handoff",
			"ci.wait": pollCi("pi"),
			"review.call":
				'One `reviewer` call with `async: false`, so this turn waits for it, `output` set to the absolute path of `review.md`, `outputMode: "file-only"`.',
		},
	},
	claude: {
		name: "claude",
		home: ".claude",
		prefix: "claude-",
		image: "my-claude:v1",
		sbxFlags: ["-t", "my-claude:v1", "--skills=off"],
		env: ["FORCE_COLOR=3"],
		agentSpec: () => "claude",
		agentArgs: [],
		resume: "--continue",
		projectConfig: ".claude",
		sbxGuidance: "CLAUDE.md",
		containerSessions: "/home/agent/.claude/projects",
		cache: "fleet-cache",
		handoffTakesText: false,
		tokens: {
			"tool.ask": "AskUserQuestion",
			"skill.ingest": "/ingest",
			refs: "`~/.claude/refs/artifacts.md`",
			"refs.ci": "`~/.claude/refs/ci.md`",
			"refs.ticket": "`~/.claude/refs/ticket.md`",
			"steer.result":
				"steered; the container takes it after its current step, and `fleet watch` reports how it settles",
			"watch.source":
				"Nothing watches a container by itself here: this session has no extension that can start a turn, so the wake is `fleet watch`, held with `Monitor` at `timeout_ms: 1800000`, its maximum. Start it before the first steer and keep one Monitor per session; its expiry notice, and a notice that it stopped with an earlier session, is the re-arm, before anything else. With no names it follows the containers whose latest `fleet up` or `fleet steer` came from this herdr pane, drops one at its `fleet down`, and picks up new ones within 30 seconds; names add those sandboxes beside them, whoever put them up. Its first line is `[fleet] watching ...`; a Monitor that never printed it never subscribed, so restart it. Before a long run, arm the limit resume as well: one more `fleet watch` as a `Bash` call with `run_in_background: true`, which has no Monitor expiry, so it resumes containers the account limit stopped while that limit stops this session too.",
			"reload.models": "after `align-settings.py --apply`",
			"delegation.parallel":
				'"Parallel" = several `Agent` calls with `subagent_type` `explorer` or `researcher` in one message, each with `run_in_background: true`, results collected before any synthesis',
			"handoff.command": "/clear",
			"ci.wait":
				"Run it as one `Bash` call with `run_in_background: true`: the session stays steerable, and the loop's exit wakes you. Until then do what does not need CI, or end the turn.",
			"review.call":
				'One foreground `Agent` call with `subagent_type: "reviewer"`, so this turn waits for it; its final message is `review.md`, and you write it to the absolute path unchanged.',
		},
	},
};
