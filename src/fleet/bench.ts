import { createHash } from "node:crypto";
import { CLI, KINDS } from "../harness.ts";
import { resolveSandbox, sessionUsage, steer, stop } from "./commands.ts";
import { containerPatch } from "./diff.ts";
import { FLEET } from "./home.ts";
import type { Io } from "./io.ts";
import { sandboxName, slug } from "./name.ts";
import { sandboxes } from "./status.ts";
import { TICKET_STUB, up } from "./up.ts";
import { watch } from "./watch.ts";

export const FROZEN_BASE = "Frozen base:";
export const FINAL_COMMITS = `cd "$WORKSPACE_DIR" || exit 1
base="$(git rev-parse "$1^{commit}")" || exit 1
head="$(git rev-parse HEAD)" || exit 1
bundled=0
if ! git merge-base --is-ancestor HEAD "$base"; then git bundle create --quiet "$2" "$base..HEAD" || exit 1; bundled=1; fi
printf '%s\t%s\t%s' "$head" "$(git status --porcelain | wc -l | tr -d ' ')" "$bundled"`;
const HIDDEN = new Set(["ticket.md", "task.json", "rubric.md", "graders"]);

function asksQuestions(said: string): boolean {
	const lines = said.split("\n");
	const heading = lines.findIndex((line) => /^[#*\s]*open questions\b/i.test(line));
	if (heading < 0) return false;
	const next = lines.findIndex((line, index) => index > heading && /^#/.test(line));
	return lines
		.slice(heading + 1, next < 0 ? undefined : next)
		.some((line) => line.trim() && !/^[-*\d.)\s]*none\.?$/i.test(line.trim()));
}

export type Settled = { state: "done" | "idle" | "blocked" | "error" | "timeout"; said: string };
type Wait = (sandbox: string, io: Io, timeoutMs: number, start: () => void) => Promise<Settled>;

type BenchInput = {
	root: string;
	repo: string;
	image: string;
	tasks: string[];
	reps: number;
	parallel: number;
	timeoutMs: number;
};

type Seed = { ticket: string; spec: string; base: string; attachments: string[] };

export function settle(sandbox: string, io: Io, timeoutMs: number, start: () => void): Promise<Settled> {
	const settled = new RegExp(`^\\[fleet\\] ${sandbox}: (done|idle|blocked|error)(?:\\n\\n([\\s\\S]*))?$`);
	return new Promise((resolve) => {
		const finish = (result: Settled) => {
			clearTimeout(cap);
			watching.stop();
			resolve(result);
		};
		const watching = watch(() => [sandbox], io, (text) => {
			const hit = text.match(settled);
			if (hit) finish({ state: hit[1] as Settled["state"], said: hit[2] ?? "" });
		});
		const cap = setTimeout(() => finish({ state: "timeout", said: "" }), timeoutMs);
		start();
	});
}

function readSeed(dir: string, io: Io): Seed {
	const ticket = io.read(`${dir}/ticket.md`);
	const spec = io.read(`${dir}/task.json`);
	if (ticket === undefined || spec === undefined) throw new Error(`${dir} needs ticket.md and task.json`);
	const { base } = JSON.parse(spec) as { base?: string };
	if (!base) throw new Error(`${dir}/task.json names no base`);
	return { ticket, spec, base, attachments: io.list(dir).filter((name) => !HIDDEN.has(name)) };
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export async function benchRun(input: BenchInput, io: Io, wait: Wait = settle): Promise<void> {
	const kind = Object.values(KINDS).find((entry) => input.image.startsWith(`${entry.image.split(":")[0]}:`));
	if (!kind) throw new Error(`--image takes an image fleet build --tag built, such as my-claude:<tag>, not ${input.image}`);
	const tag = input.image.slice(input.image.indexOf(":") + 1);
	const seeds = `${io.home}/${FLEET.bench}/tasks`;
	const runs = input.tasks.flatMap((task) =>
		Array.from({ length: input.reps }, (_, index) => {
			const label = `${tag}-${task}-${index + 1}`;
			return { task, rep: index + 1, label, sandbox: sandboxName(input.repo, label, kind.prefix), dir: `${io.home}/${FLEET.bench}/runs/${slug(tag)}/${task}-${index + 1}` };
		}),
	);
	const names = runs.map((run) => run.sandbox);
	if (new Set(names).size !== names.length)
		throw new Error(`two runs would share the sandbox name ${names.find((name, index) => names.indexOf(name) !== index)}; shorten the tag or the task ids`);
	const kept = runs.find((run) => io.stat(run.dir));
	if (kept) throw new Error(`${kept.dir} already holds a run; a rep starts from an empty directory, so move it away or take another tag`);
	const live = sandboxes(io).find((sandbox) => names.includes(sandbox.name));
	if (live) throw new Error(`${live.name} already exists; take it down with ${CLI} down --force ${live.name} before the batch reuses its name`);
	const seeded = new Map(input.tasks.map((task) => [task, readSeed(`${seeds}/${task}`, io)]));
	const one = async (run: (typeof runs)[number]) => {
		const seed = seeded.get(run.task)!;
		const task = `${run.dir}/${run.sandbox}`;
		const startedAt = io.now().toISOString();
		const record = (outcome: { status: string } & Record<string, unknown>) => {
			const result = {
				task: run.task,
				rep: run.rep,
				sandbox: run.sandbox,
				...outcome,
				image: { ref: input.image, stamp: io.read(`${task}/logs/image-stamp`)?.trim() ?? null },
				seed: { ticket_sha256: sha256(seed.ticket), task_sha256: sha256(seed.spec) },
				base: seed.base,
				started_at: startedAt,
				finished_at: io.now().toISOString(),
				transcripts: `${run.sandbox}/logs/sessions`,
				task_dir: run.sandbox,
				graders: null,
				judge: null,
			};
			io.write(`${run.dir}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
			io.log(`${run.sandbox}: ${outcome.status} -> ${run.dir}`);
		};
		io.mkdir(run.dir);
		try {
			await up(
				{
					repo: input.repo,
					label: run.label,
					root: input.root,
					kind: kind.name,
					image: input.image,
					baseCommit: seed.base,
					artifacts: run.dir,
					container: { push: "none", pr: "none", linear: "none" },
				},
				io,
			);
			io.write(`${task}/ticket.md`, `${TICKET_STUB}${FROZEN_BASE} ${seed.base}\n\n${seed.ticket}`);
			for (const name of seed.attachments) io.run("cp", ["-R", `${seeds}/${run.task}/${name}`, `${task}/`]);
			const settled = await wait(run.sandbox, io, input.timeoutMs, () =>
				steer(resolveSandbox(run.sandbox, io), `Deliver the ticket in ${task}/ticket.md end to end on its frozen base ${seed.base}. Commit locally and stop at Done; nothing leaves this container. Wait for background work in the foreground: end your turn only at Done or on an open question, since the run ends when your turn does.`, io, input.root),
			);
			const status =
				settled.state === "timeout" ? "timeout"
				: settled.state === "error" ? "error"
				: settled.state === "blocked" || asksQuestions(settled.said) ? "blocked"
				: "done";
			const [head, dirty, bundled] = io
				.sbx(["exec", run.sandbox, "sh", "-c", FINAL_COMMITS, "--", seed.base, `${run.dir}/head.bundle`], { quiet: true })
				.split("\t");
			io.write(`${run.dir}/diff.patch`, containerPatch(run.sandbox, io) ?? "");
			const usage = sessionUsage(task, io);
			if (usage) io.write(`${run.dir}/usage.json`, `${JSON.stringify(usage, null, 2)}\n`);
			stop(resolveSandbox(run.sandbox, io), io);
			record({
				status,
				closing_message: settled.said,
				head,
				dirty: Number(dirty),
				bundle: bundled === "1" ? "head.bundle" : null,
				diff: "diff.patch",
				usage: usage ? "usage.json" : null,
			});
		} catch (error) {
			const running = sandboxes(io).find((sandbox) => sandbox.name === run.sandbox && sandbox.status !== "stopped");
			if (running) stop(running, io);
			record({ status: "error", error: (error as Error).message });
		}
	};
	const queue = [...runs];
	try {
		await Promise.all(
			Array.from({ length: input.parallel }, async () => {
				for (let run = queue.shift(); run; run = queue.shift()) await one(run);
			}),
		);
	} finally {
		const kept = sandboxes(io).filter((sandbox) => names.includes(sandbox.name));
		if (kept.length) io.log("Stopped, with their files kept; discarding them is yours:");
		for (const sandbox of kept) io.log(`${CLI} down --force ${sandbox.name}`);
	}
}
