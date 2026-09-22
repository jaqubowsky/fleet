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
	agentSpec(root: string): string;
	agentArgs: string[];
	resume: string;
	sessionEnv?: string;
	codex?: { auth: string; kit: string };
	projectConfig?: string;
	containerSessions?: string;
	cache: string;
	deliverAs?: "followUp" | "nextTurn";
	tokens: Record<string, string>;
};

const REFS_BESIDE_AGENTS = "`refs/artifacts.md` beside `AGENTS.md`";
const PI_WATCH = "Steer returns at once and puts the container under watch; the `[fleet]` wake is where the outcome lands.";

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
		agentSpec: (root) => `${root}/pi/kits/pi`,
		agentArgs: ["--approve"],
		resume: "-c",
		sessionEnv: "PI_CODING_AGENT_SESSION_DIR",
		codex: { auth: "agent/auth.json", kit: "pi" },
		cache: "cache",
		deliverAs: "followUp",
		tokens: {
			cli: "fleet",
			harness: "pi",
			"tool.ask": "ask_user_question",
			"skill.ingest": "/skill:ingest",
			refs: REFS_BESIDE_AGENTS,
			watch: PI_WATCH,
			"review.saver": "the runtime",
			"steer.result": "steered; pi takes it after its current tool call, and the container is under watch from now on",
			cache: "~/.pi/cache/<repo>",
			reload: "after `/reload`",
			"watch.owner": "Only the Pi session that ran `fleet up` or `fleet steer` auto-watches that container: the event carries the shell's `PI_SESSION_ID`, matched against the extension's current session ID. Resuming that same session restores its watches. Legacy or ownerless events never auto-watch.",
			"delegation.parallel": "\"Parallel\" = several `explorer` or `researcher` runs started in the same turn, in the background, results collected before any synthesis",
			"model.flag": "<provider/id:thinking>",
			"models.row": "| switch models for new containers | `fleet render` after editing `pi/profiles/models.json` in the harness repo | files rewritten; host sees it after `/reload`, containers after `fleet build` |",
		},
	},
	omp: {
		name: "omp",
		cli: "ofleet",
		home: ".omp",
		prefix: "omp-",
		agent: "omp",
		image: "my-omp:v1",
		owner: "pane",
		sbxFlags: ["--skills=off"],
		agentSpec: (root) => `${root}/omp/kits/omp`,
		agentArgs: ["--yolo"],
		resume: "-c",
		sessionEnv: "PI_CODING_AGENT_SESSION_DIR",
		codex: { auth: "agent/auth.json", kit: "omp" },
		cache: "cache",
		deliverAs: "nextTurn",
		tokens: {
			cli: "ofleet",
			harness: "omp",
			"tool.ask": "ask",
			"skill.ingest": "/skill:ingest",
			refs: REFS_BESIDE_AGENTS,
			watch: PI_WATCH,
			"review.saver": "the runtime",
			"steer.result": "steered; omp takes it after its current tool call, and the container is under watch from now on",
			cache: "~/.omp/cache/<repo>",
			reload: "after `/reload`",
			"watch.owner": "Only the omp session in the pane that ran `ofleet up` or `ofleet steer` auto-watches that container: omp exports no session id to its shell, so the event carries the herdr pane id, and a restart in the same pane restores its watches.",
			"delegation.parallel": "\"Parallel\" = one `task` batch holding several independent `explorer` or `researcher` items, started together, results collected before any synthesis",
			"model.flag": "<provider/id:thinking>",
			"models.row": "| switch models for new containers | `ofleet render` after editing `omp/profiles/models.json` in the harness repo | files rewritten; host sees it after `/reload`, containers after `ofleet build` |",
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
		agentSpec: () => "claude",
		agentArgs: ["--dangerously-skip-permissions"],
		resume: "--continue",
		projectConfig: ".claude",
		containerSessions: "/home/agent/.claude/projects",
		cache: "fleet-cache",
		tokens: {
			cli: "cfleet",
			harness: "claude",
			"tool.ask": "AskUserQuestion",
			"skill.ingest": "/ingest",
			refs: "`refs/artifacts.md` in `~/.claude/rules`",
			watch: "Steer returns at once; the `[fleet]` wake is where the outcome lands, and it reaches you only through `cfleet watch` held with `Monitor`, `persistent: true`: start it before the first steer, one per session.",
			"review.saver": "the calling session",
			"steer.result": "steered; claude takes it as its next message, and `cfleet watch` reports how it settles",
			cache: "~/.claude/fleet-cache/<repo>",
			reload: "in its next session",
			"delegation.parallel": "\"Parallel\" = several `Agent` calls with `subagent_type` `explorer` or `researcher` in one message, each with `run_in_background: true`, results collected before any synthesis",
			"model.flag": "<opus|sonnet|model id>",
			"models.row": "| switch models for new containers | `cfleet render` then `cfleet build` after editing `claude/profiles/models.json` in the harness repo, or `--model` on one `cfleet up` | the image carries it; the host takes it from `align-settings.py --apply` |",
		},
	},
};

export function harness(name: string | undefined): Harness {
	const found = HARNESSES[(name ?? "pi") as HarnessName];
	if (!found) throw new Error(`no harness named ${name}; known: ${Object.keys(HARNESSES).join(", ")}`);
	return found;
}
