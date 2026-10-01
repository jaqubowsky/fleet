import { basename } from "node:path";
import { repoName } from "../profile/profile.ts";
import type { Io } from "./io.ts";
import { slug } from "./name.ts";
import { repoProfile } from "./permissions.ts";
import {
	repositoryCheckout,
	repositoryManifest,
	type RepositoryManifest,
} from "./repositories.ts";
import { sandboxes } from "./status.ts";

export type LandInput = {
	sandbox: string;
	repo: string;
	root: string;
	sign?: boolean;
	push?: boolean;
	branch?: string;
};

type Entry = RepositoryManifest["repositories"][number];

type Landing = {
	entry: Entry;
	branch: string;
	signs: boolean;
	pushes: boolean;
	refs: string;
	head?: string;
};

const NO_REF = "0".repeat(40);

export function baseBranch(repo: string, io: Io): string {
	for (const candidate of [
		"origin/HEAD",
		"origin/main",
		"origin/master",
		"main",
		"master",
	]) {
		try {
			io.git(["rev-parse", "--verify", "--quiet", candidate], repo);
			return candidate === "origin/HEAD"
				? io.git(["rev-parse", "--abbrev-ref", "origin/HEAD"], repo)
				: candidate;
		} catch {
			continue;
		}
	}
	throw new Error(`no base branch in ${repo}`);
}

export function isBase(base: string, branch: string): boolean {
	return base === branch || base.endsWith(`/${branch}`);
}

export function landRefusal(
	checkout: { branch: string; dirty: number },
	checkedOut: string[],
	base: string,
): string | undefined {
	if (checkout.dirty)
		return `${checkout.dirty} uncommitted file(s) in the container on ${checkout.branch}; commit or discard there first`;
	if (!checkout.branch) return "container is on a detached HEAD";
	if (isBase(base, checkout.branch))
		return `${checkout.branch} is the base branch; give the work its own branch in the container first`;
	if (checkedOut.includes(checkout.branch))
		return `${checkout.branch} is checked out in the host repository; switch away first`;
	return undefined;
}

export function landedRef(sandbox: string, entry: Entry): string {
	return `refs/fleet/${sandbox}/${slug(basename(entry.workspace))}/landed`;
}

export function isAncestor(
	repo: string,
	ancestor: string,
	descendant: string,
	io: Io,
): boolean {
	try {
		io.git(["merge-base", "--is-ancestor", ancestor, descendant], repo);
		return true;
	} catch {
		return false;
	}
}

export function land(input: LandInput, io: Io): void {
	const entries = recordedOrProbed(input, io);
	if (input.repo !== entries[0].repo)
		throw new Error(
			`${input.sandbox} belongs to ${entries[0].repo}, not ${input.repo}`,
		);
	const several = entries.length > 1;
	const landings: Landing[] = entries.map((entry) => {
		const { host } = repoProfile(input.root, entry.name, io);
		return {
			entry,
			branch: several ? entry.branch : (input.branch ?? entry.branch),
			signs: input.sign === true || host.sign !== "none",
			pushes: host.push !== "none",
			refs: landedRef(input.sandbox, entry).slice(0, -"/landed".length),
		};
	});
	try {
		if (input.branch && several)
			throw new Error(
				"--branch names one repository's branch; a multi-repository land takes the branch recorded for each",
			);
		for (const { entry, pushes } of landings)
			if (input.push && !pushes)
				throw new Error(
					`${entry.name}: this repository's profile gives the host no push (host.push is none in ~/.fleet/config/repos.json or host/repos.json); the branch reaches GitHub another way`,
				);
		for (const { entry, refs } of landings)
			if (input.branch && ref(entry.repo, `${refs}/landed`, io))
				throw new Error(
					`${entry.name}: ${refs}/landed already anchors the recorded branch ${entry.branch}; --branch would move that anchor, so land without it`,
				);
		io.sbx(["exec", input.sandbox, "true"], { quiet: true });
		const url = io.git(
			["remote", "get-url", `sandbox-${input.sandbox}`],
			entries[0].repo,
		);
		for (const landing of landings) fetch(landing, url, input.push === true, io);
		const moves = landings.map((landing) =>
			preflight(landing, input, io),
		);
		for (const [index, landing] of landings.entries())
			move(landing, moves[index], input.sandbox, io);
		for (const landing of landings)
			if (landing.signs) sign(landing, io);
			else
				io.log(
					`${landing.entry.name}: unsigned commits stay unsigned; rerun with --sign to sign them (one Touch ID tap per commit)`,
				);
		if (input.push) for (const landing of landings) push(landing, io);
	} finally {
		for (const landing of landings) io.log(progress(landing, io));
	}
}

function recordedOrProbed(input: LandInput, io: Io): Entry[] {
	const manifest = repositoryManifest(input.sandbox, io);
	if (manifest) return manifest.repositories;
	const repo =
		sandboxes(io).find((s) => s.name === input.sandbox)?.workspaces[0] ??
		input.repo;
	return [
		{
			repo,
			name: repoName(io.git(["remote", "get-url", "origin"], repo)),
			base: baseBranch(repo, io).replace(/^origin\//, ""),
			baseSha: "",
			branch: repositoryCheckout(io, input.sandbox, repo).branch,
			workspace: repo,
			served: "",
		},
	];
}

function fetch(landing: Landing, url: string, pushes: boolean, io: Io): void {
	const { entry, branch } = landing;
	io.git(
		[
			"-c",
			"fetch.fsckObjects=true",
			"fetch",
			"--quiet",
			"--no-tags",
			"--no-recurse-submodules",
			`${url}${entry.served}`,
			`+refs/heads/${branch}:${landing.refs}/incoming`,
		],
		entry.repo,
	);
	if (!landing.signs && !pushes) return;
	io.git(["fetch", "--quiet", "origin", entry.base], entry.repo);
	try {
		io.git(["fetch", "--quiet", "origin", branch], entry.repo);
	} catch {}
}

type Move = {
	incoming: string;
	host: string;
	landed: string;
	recorded: string;
	forward: boolean;
};

function preflight(landing: Landing, input: LandInput, io: Io): Move {
	const { entry, branch } = landing;
	const checkout = repositoryCheckout(io, input.sandbox, entry.workspace);
	landing.head = checkout.head;
	const checkedOut = io
		.git(["worktree", "list", "--porcelain"], entry.repo)
		.split("\n")
		.filter((line) => line.startsWith("branch refs/heads/"))
		.map((line) => line.slice("branch refs/heads/".length));
	const refusal = landRefusal(
		{ dirty: checkout.dirty, branch: input.branch ?? checkout.branch },
		checkedOut,
		`origin/${entry.base}`,
	);
	if (refusal) throw new Error(`${entry.name}: ${refusal}`);
	if (!input.branch && checkout.branch !== branch)
		throw new Error(
			`${entry.name}: expected branch ${branch}, found ${checkout.branch}`,
		);
	const incoming = io.git(["rev-parse", `${landing.refs}/incoming`], entry.repo);
	if (checkout.branch === branch && incoming !== checkout.head)
		throw new Error(
			`${entry.name}: ${branch} moved in the container while it was fetched; nothing moved here`,
		);
	if (entry.baseSha && !isAncestor(entry.repo, entry.baseSha, incoming, io))
		throw new Error(
			`${entry.name}: ${incoming} does not descend from the recorded base ${entry.baseSha}`,
		);
	const host = ref(entry.repo, `refs/heads/${branch}`, io);
	const recorded = ref(entry.repo, `${landing.refs}/landed`, io);
	const forward = !host || isAncestor(entry.repo, host, incoming, io);
	const landed =
		recorded ||
		(forward ? "" : mirrored(entry.repo, input.sandbox, branch, host, io));
	if (!forward && !(landed && isAncestor(entry.repo, landed, incoming, io)))
		throw new Error(
			`${entry.name}: ${branch} in the container descends neither from ${branch} here nor from what was last landed, so importing it would drop what this repo already holds, signatures included; resync the container with git fetch origin && git reset --hard origin/${branch}, or delete ${branch} here when the container's history is the one you want`,
		);
	return { incoming, host, landed, recorded, forward };
}

function mirrored(
	repo: string,
	sandbox: string,
	branch: string,
	host: string,
	io: Io,
): string {
	const mirror = ref(repo, `refs/sandboxes/${sandbox}/${branch}`, io);
	const tree = (commit: string) =>
		io.git(["rev-parse", `${commit}^{tree}`], repo);
	return mirror && tree(mirror) === tree(host) ? mirror : "";
}

function move(landing: Landing, plan: Move, sandbox: string, io: Io): void {
	const { entry, branch } = landing;
	const target = plan.forward
		? plan.incoming
		: rebuild(entry.repo, plan, io);
	io.git(["update-ref", "--stdin"], entry.repo, {
		input: [
			"start",
			`update refs/heads/${branch} ${target} ${plan.host || NO_REF}`,
			`update ${landing.refs}/landed ${plan.incoming} ${plan.recorded || NO_REF}`,
			"prepare",
			"commit",
			"",
		].join("\n"),
	});
	io.log(`${entry.name}: ${branch} <- ${sandbox} (base origin/${entry.base})`);
	io.log(
		io.git(
			["--no-pager", "log", "--format=%h %G? %s", `origin/${entry.base}..${branch}`],
			entry.repo,
		),
	);
	io.log(
		io.git(
			["--no-pager", "diff", "--stat", `origin/${entry.base}...${branch}`],
			entry.repo,
		),
	);
}

function rebuild(repo: string, plan: Move, io: Io): string {
	const mapped = new Map([[plan.landed, plan.host]]);
	for (const commit of io
		.git(
			[
				"rev-list",
				"--reverse",
				"--topo-order",
				"--ancestry-path",
				`${plan.landed}..${plan.incoming}`,
			],
			repo,
		)
		.split("\n")
		.filter(Boolean))
		mapped.set(commit, recreate(repo, commit, mapped, false, io));
	return mapped.get(plan.incoming)!;
}

function recreate(
	repo: string,
	commit: string,
	mapped: Map<string, string>,
	signs: boolean,
	io: Io,
): string {
	const raw = io.git(["cat-file", "commit", commit], repo);
	const split = raw.indexOf("\n\n");
	const header = split < 0 ? raw : raw.slice(0, split);
	const message = split < 0 ? "" : raw.slice(split + 2);
	const tree = /^tree (\S+)$/m.exec(header)![1];
	const parents = [...header.matchAll(/^parent (\S+)$/gm)].map((m) => m[1]);
	const [, name, email, date] = /^author (.*) <(.*)> (\d+ [+-]\d{4})$/m.exec(
		header,
	)!;
	return io.git(
		[
			"commit-tree",
			...(signs ? ["-S"] : []),
			tree,
			...parents.flatMap((parent) => ["-p", mapped.get(parent) ?? parent]),
		],
		repo,
		{
			env: {
				GIT_AUTHOR_NAME: name,
				GIT_AUTHOR_EMAIL: email,
				GIT_AUTHOR_DATE: date,
			},
			input: `${message}\n`,
		},
	);
}

function sign(landing: Landing, io: Io): void {
	const { entry, branch } = landing;
	const published = ref(entry.repo, `refs/remotes/origin/${branch}`, io);
	const tip = io.git(["rev-parse", `refs/heads/${branch}`], entry.repo);
	const mapped = new Map<string, string>();
	for (const line of io
		.git(
			[
				"log",
				"--reverse",
				"--topo-order",
				"--format=%H %G? %P",
				tip,
				"--not",
				`origin/${entry.base}`,
				...(published ? [published] : []),
			],
			entry.repo,
		)
		.split("\n")
		.filter(Boolean)) {
		const [commit, verdict, ...parents] = line.split(" ");
		if (verdict !== "G" || parents.some((parent) => mapped.has(parent)))
			mapped.set(commit, recreate(entry.repo, commit, mapped, true, io));
	}
	const signed = mapped.get(tip);
	if (!signed) return;
	io.git(["update-ref", `refs/heads/${branch}`, signed, tip], entry.repo);
	io.log(`${entry.name}: ${mapped.size} commit(s) signed on ${branch}`);
}

function push(landing: Landing, io: Io): void {
	const { entry, branch } = landing;
	const tip = io.git(["rev-parse", `refs/heads/${branch}`], entry.repo);
	const remote = io
		.git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`], entry.repo)
		.split(/\s+/)[0];
	if (remote === tip) return;
	try {
		io.git(
			[
				"push",
				"--quiet",
				"-u",
				"origin",
				`refs/heads/${branch}:refs/heads/${branch}`,
			],
			entry.repo,
		);
	} catch (error) {
		throw new Error(
			`${entry.name}: ${branch} stayed local: ${(error as Error).message}\nthe branch is no longer a fast-forward of origin; forcing it is your own command`,
		);
	}
	io.log(`${entry.name}: ${branch} -> origin`);
}

function progress(landing: Landing, io: Io): string {
	const { entry, branch } = landing;
	const host = ref(entry.repo, `refs/heads/${branch}`, io);
	const origin = ref(entry.repo, `refs/remotes/origin/${branch}`, io);
	const verdict = host
		? io.git(["log", "-1", "--format=%G?", host], entry.repo)
		: "-";
	return `${entry.name}: container ${landing.head ?? "?"}, host ${host || "none"}, origin/${branch} ${origin || "none"}, tip ${verdict}`;
}

function ref(repo: string, name: string, io: Io): string {
	return io.git(["for-each-ref", "--format=%(objectname)", name], repo);
}
