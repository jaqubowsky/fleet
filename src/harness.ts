export type AgentName = "pi" | "claude";

export const CLI = "fleet";

export type Seat = {
	name: AgentName;
	sessionIdEnv: string;
};

export const SEATS: Record<AgentName, Seat> = {
	pi: { name: "pi", sessionIdEnv: "PI_SESSION_ID" },
	claude: { name: "claude", sessionIdEnv: "CLAUDE_CODE_SESSION_ID" },
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
	tokens: Record<string, string>;
	hostTokens?: Record<string, string>;
};

const REFS_BESIDE_AGENTS = "`refs/artifacts.md` beside `AGENTS.md`";
const CI_BESIDE_AGENTS = "`refs/ci.md` beside `AGENTS.md`";
const GATES_BESIDE_AGENTS = "`refs/gates.md` beside `AGENTS.md`";
const TICKET_BESIDE_AGENTS = "`refs/ticket.md` beside `AGENTS.md`";
const DESIGN_BESIDE_AGENTS = "`refs/design.md` beside `AGENTS.md`";
const PROSE_BESIDE_AGENTS = "`refs/prose.md` beside `AGENTS.md`";
const watchSource = (cli: string) =>
	`Only the session that ran \`${cli} up\`, \`${cli} start\` or \`${cli} steer\` auto-watches that container, and resuming that session restores its watches. The watch keeps running while the session waits out an account limit. \`fleet_watch <sandbox...>\`, or \`/fleet-watch [names]\` typed by the user, watches any container by the name \`${cli} ls\` prints; no name watches every one. A fleet wake is a follow-up turn after the current run settles, not context saved for the next user prompt.`;
const RELOAD_MODELS = "after `/reload`";
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
		tokens: {
			"tool.ask": "ask_user_question",
			"skill.ingest": "/skill:ingest",
			skills: "`~/.pi/skills/<name>/SKILL.md`, never under `agent/`",
			refs: REFS_BESIDE_AGENTS,
			"refs.ci": CI_BESIDE_AGENTS,
			"refs.ticket": TICKET_BESIDE_AGENTS,
			"refs.design": DESIGN_BESIDE_AGENTS,
			"refs.prose": PROSE_BESIDE_AGENTS,
			"refs.gates": GATES_BESIDE_AGENTS,
			"watch.source": watchSource("fleet"),
			"reload.models": RELOAD_MODELS,
			"delegation.parallel":
				'"Parallel" = several `explorer` or `researcher` runs started in the same turn, in the background, results collected before any synthesis',
			"ci.wait":
				"pi runs it in the foreground, so give that bash call no timeout or one above 1260 seconds; a steer lands after it returns.",
			"reviewer.output": "written to review.md",
			"review.call":
				'One `reviewer` call with `async: true`, `output` set to the absolute path of `review.md`, `outputMode: "file-only"`. Leave the working tree untouched until `review.md` arrives: continue other read-only work or end the turn, and native completion wakes the session. Read the report before deciding what to fix.',
		},
		hostTokens: {
			skills: "`~/.pi/skills/shared/<name>/SKILL.md` for a shared skill, `~/.pi/skills/host/<name>/SKILL.md` for a host one",
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
		tokens: {
			"tool.ask": "AskUserQuestion",
			"skill.ingest": "/ingest",
			skills: "`~/.claude/skills/<name>/SKILL.md`",
			refs: "`~/.claude/refs/artifacts.md`",
			"refs.ci": "`~/.claude/refs/ci.md`",
			"refs.ticket": "`~/.claude/refs/ticket.md`",
			"refs.design": "`~/.claude/refs/design.md`",
			"refs.prose": "`~/.claude/refs/prose.md`",
			"refs.gates": "`~/.claude/refs/gates.md`",
			"watch.source":
				"Only the session that ran `fleet up`, `fleet start` or `fleet steer` auto-watches that container, until its `fleet down`. The watch keeps running while the session waits out an account limit. `mcp__fleet__watch` with sandbox names, or `/fleet-watch [names]` typed by the user, watches any container by the name `fleet ls` prints; no name watches every one. A fleet wake is a follow-up turn after the current run settles, not context saved for the next user prompt.",
			"reload.models": "after `align-settings.py --apply`",
			"delegation.parallel":
				'"Parallel" = several `Agent` calls with `subagent_type` `explorer` or `researcher` in one message, each with `run_in_background: true`, results collected before any synthesis',
			"ci.wait":
				"Run it as one `Bash` call with `run_in_background: true`: the session stays steerable, and the loop's exit wakes you. Until then do what does not need CI, or end the turn.",
			"reviewer.output": "returned to the caller, who writes it to review.md",
			"review.call":
				'One `Agent` call with `subagent_type: "reviewer"`. It runs in the background: leave the working tree untouched until its task notification arrives, and continue other read-only work or end the turn. The notification carries its final message, which is `review.md`; write it to the absolute path unchanged.',
		},
	},
};
