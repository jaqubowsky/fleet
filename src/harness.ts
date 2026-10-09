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
	handoffTakesText: boolean;
	tokens: Record<string, string>;
};

const REFS_BESIDE_AGENTS = "`refs/artifacts.md` beside `AGENTS.md`";
const CI_BESIDE_AGENTS = "`refs/ci.md` beside `AGENTS.md`";
const TICKET_BESIDE_AGENTS = "`refs/ticket.md` beside `AGENTS.md`";
const DESIGN_BESIDE_AGENTS = "`refs/design.md` beside `AGENTS.md`";
const PROSE_BESIDE_AGENTS = "`refs/prose.md` beside `AGENTS.md`";
const watchSource = (cli: string, env: string) =>
	`Only the session that ran \`${cli} up\` or \`${cli} steer\` auto-watches that container: the fleet monitor puts the session ID in \`${env}\` on every \`${cli}\` command the session runs, and the event carries it. Resuming that same session restores its watches, and the monitor keeps running while the session waits out an account limit. Ownerless events never auto-watch. \`fleet_watch <sandbox...>\`, or \`/fleet-watch [names]\` typed by the user, explicitly watches containers regardless of ownership, by the sandbox name \`${cli} ls\` prints; no name watches every container. A fleet wake is a follow-up turn after the current run settles, not context saved for the next user prompt.`;
const RELOAD_MODELS = "after `/reload`";
export const CONTINUE =
	"Continue the previous task from its current frontier, following the Session handoff rule in your container instructions.";

export const KINDS: Record<AgentName, Kind> = {
	pi: {
		name: "pi",
		home: ".pi",
		prefix: "pi-",
		image: "my-pi:v1",
		sbxFlags: ["--skills=off"],
		env: [],
		agentSpec: (root) => `${root}/pi/kits/pi`,
		agentArgs: ["--approve"],
		resume: "-c",
		sessionEnv: "PI_CODING_AGENT_SESSION_DIR",
		herdrIntegration: "agent/extensions/herdr-agent-state.ts",
		codex: { auth: "agent/auth.json", kit: "pi" },
		handoffTakesText: true,
		tokens: {
			"tool.ask": "ask_user_question",
			"skill.ingest": "/skill:ingest",
			refs: REFS_BESIDE_AGENTS,
			"refs.ci": CI_BESIDE_AGENTS,
			"refs.ticket": TICKET_BESIDE_AGENTS,
			"refs.design": DESIGN_BESIDE_AGENTS,
			"refs.prose": PROSE_BESIDE_AGENTS,
			"steer.result":
				"steered; the container takes it after its current step, and it is under watch from now on",
			"watch.source": watchSource("fleet", "PI_SESSION_ID"),
			"reload.models": RELOAD_MODELS,
			"delegation.parallel":
				'"Parallel" = several `explorer` or `researcher` runs started in the same turn, in the background, results collected before any synthesis',
			"handoff.command": "/session-handoff",
			"ci.wait": "",
			"review.call":
				'One `reviewer` call with `async: true`, `output` set to the absolute path of `review.md`, `outputMode: "file-only"`. Continue independent work or end the turn; native completion wakes the session. Read the report before deciding what to fix.',
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
		handoffTakesText: false,
		tokens: {
			"tool.ask": "AskUserQuestion",
			"skill.ingest": "/ingest",
			refs: "`~/.claude/refs/artifacts.md`",
			"refs.ci": "`~/.claude/refs/ci.md`",
			"refs.ticket": "`~/.claude/refs/ticket.md`",
			"refs.design": "`~/.claude/refs/design.md`",
			"refs.prose": "`~/.claude/refs/prose.md`",
			"steer.result":
				"steered; the container takes it after its current step, and it is under watch from now on",
			"watch.source":
				"Only the session in the herdr pane that ran `fleet up` or `fleet steer` auto-watches that container: the fleet mod holds `fleet watch` for the session's life, following the containers whose latest `fleet up` or `fleet steer` came from this pane and dropping one at its `fleet down`. It picks up new ones within 30 seconds and keeps running while the session waits out an account limit, resuming the containers that limit stopped. `mcp__fleet__watch` with sandbox names, or `/fleet-watch [names]` typed by the user, explicitly watches containers regardless of ownership, by the sandbox name `fleet ls` prints; no name watches every container. A fleet wake is a follow-up turn after the current run settles, not context saved for the next user prompt.",
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
