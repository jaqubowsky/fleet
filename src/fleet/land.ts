import { basename } from "node:path";
import { repoName } from "../profile/profile.ts";
import type { Io } from "./io.ts";
import { repoProfile } from "./permissions.ts";
import {
	taskDir,
	repositoryCheckout,
	repositoryManifest,
	saveRepositories,
	type RepositoryManifest,
} from "./repositories.ts";
import { checkoutProbe, parseCheckout } from "./status.ts";

export type LandInput = {
	sandbox: string;
	repo: string;
	root: string;
	sign?: boolean;
	push?: boolean;
	branch?: string;
};

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
	current: string,
	base: string,
): string | undefined {
	if (checkout.dirty)
		return `${checkout.dirty} uncommitted file(s) in the container on ${checkout.branch}; commit or discard there first`;
	if (!checkout.branch) return "container is on a detached HEAD";
	if (isBase(base, checkout.branch))
		return `${checkout.branch} is the base branch; give the work its own branch in the container first`;
	if (checkout.branch === current)
		return `${checkout.branch} is checked out in the local repository; switch away first`;
	return undefined;
}

export function land(input: LandInput, io: Io): void {
	const manifest = repositoryManifest(input.sandbox, io);
	if (manifest) return landRepositories(input, manifest, io);
	const checkout = parseCheckout(
		io.sbx(["exec", input.sandbox, "sh", "-c", checkoutProbe], { quiet: true }),
	);
	const branch = input.branch ?? checkout.branch;
	const base = baseBranch(input.repo, io);
	const current = io.git(["branch", "--show-current"], input.repo);
	const refusal = landRefusal({ ...checkout, branch }, current, base);
	if (refusal) throw new Error(refusal);
	const { host } = repoProfile(
		input.root,
		repoName(io.git(["remote", "get-url", "origin"], input.repo)),
		io,
	);
	if (input.push && host.push === "none")
		throw new Error(
			"this repository's profile gives the host no push (host.push is none in ~/.config/harness/repos.json or host/repos.json); the branch reaches GitHub another way",
		);
	const signs = input.sign || host.sign !== "none";

	try {
		io.git(
			["fetch", "--quiet", `sandbox-${input.sandbox}`, `${branch}:${branch}`],
			input.repo,
		);
	} catch (error) {
		const message = (error as Error).message;
		if (!/\[rejected\]|non-fast-forward/.test(message)) throw error;
		throw new Error(
			`${branch} in the container is not a descendant of the one here, so importing it would drop what this repo already holds, signatures included\n${message}\nresync the container with git fetch origin && git reset --hard origin/${branch}, or delete ${branch} here when the container's history is the one you want`,
		);
	}
	const remote = signs || input.push;
	if (remote && base.startsWith("origin/"))
		io.git(
			["fetch", "--quiet", "origin", base.slice("origin/".length)],
			input.repo,
		);
	const pushed = remote ? remoteBranch(input.repo, branch, io) : undefined;

	io.log(`${branch} <- ${input.sandbox} (base ${base})`);
	io.log(
		io.git(
			["--no-pager", "log", "--format=%h %G? %s", `${base}..${branch}`],
			input.repo,
		),
	);
	io.log(
		io.git(["--no-pager", "diff", "--stat", `${base}...${branch}`], input.repo),
	);

	if (signs) sign(input.repo, branch, pushed ? [base, pushed] : [base], io);
	else
		io.log(
			`unsigned commits stay unsigned; rerun with --sign to sign them (one Touch ID tap per commit)`,
		);

	if (input.push) push(input.repo, branch, io);
}

function landRepositories(
	input: LandInput,
	manifest: RepositoryManifest,
	io: Io,
): void {
	if (input.repo !== manifest.repositories[0].repo)
		throw new Error(
			`${input.sandbox} belongs to ${manifest.repositories[0].repo}, not ${input.repo}`,
		);
	if (input.branch)
		throw new Error(
			"a multi-repository land uses the branch recorded for each repository",
		);
	if (input.push)
		for (const entry of manifest.repositories) {
			const { host } = repoProfile(input.root, entry.name, io);
			if (host.push === "none")
				throw new Error(`${entry.name}: the host profile does not allow pushing`);
			if (input.sign) continue;
			if (!entry.landedSha)
				throw new Error(`${entry.name}: import and sign before requesting a push`);
			if (host.sign !== "none" && entry.signedSha !== entry.landedSha)
				throw new Error(
					`${entry.name}: sign the landed branch before requesting a push`,
				);
		}
	const task = taskDir(input.repo, input.sandbox, io);
	const ready = manifest.repositories.map((entry, index) => {
		const checkout = repositoryCheckout(io, input.sandbox, entry.workspace);
		const refusal = landRefusal(
			checkout,
			io.git(["branch", "--show-current"], entry.repo),
			`origin/${entry.base}`,
		);
		if (refusal) throw new Error(`${entry.name}: ${refusal}`);
		if (checkout.branch !== entry.branch)
			throw new Error(
				`${entry.name}: expected branch ${entry.branch}, found ${checkout.branch}`,
			);
		if (io.git(["status", "--porcelain"], entry.repo))
			throw new Error(`${entry.name}: the host checkout has uncommitted work`);
		if (
			io.git(["rev-parse", `origin/${entry.base}`], entry.repo) !== entry.baseSha
		)
			throw new Error(
				`${entry.name}: base origin/${entry.base} moved from ${entry.baseSha}; resync before landing`,
			);
		try {
			io.sbx(
				[
					"exec",
					input.sandbox,
					"git",
					"-C",
					entry.workspace,
					"merge-base",
					"--is-ancestor",
					entry.baseSha,
					checkout.head,
				],
				{ quiet: true },
			);
		} catch {
			throw new Error(
				`${entry.name}: ${checkout.head} does not descend from recorded base ${entry.baseSha}`,
			);
		}
		const hostHead = io.git(
			["for-each-ref", "--format=%(objectname)", `refs/heads/${entry.branch}`],
			entry.repo,
		);
		const imported =
			entry.sourceSha === checkout.head && entry.landedSha === hostHead;
		if (input.push && !input.sign && !imported)
			throw new Error(`${entry.name}: import and sign before requesting a push`);
		if (hostHead && !imported && hostHead !== checkout.head) {
			try {
				io.sbx(
					[
						"exec",
						input.sandbox,
						"git",
						"-C",
						entry.workspace,
						"merge-base",
						"--is-ancestor",
						hostHead,
						checkout.head,
					],
					{ quiet: true },
				);
			} catch {
				throw new Error(
					`${entry.name}: ${checkout.branch} in the container does not descend from the host branch ${hostHead}`,
				);
			}
		}
		if (imported) return { entry, checkout, bundle: "", imported };
		const file = `${input.sandbox}-${index + 1}-${basename(entry.repo)}.bundle`;
		const guestBundle = `/tmp/${file}`;
		const bundle = `${io.tmp}/${file}`;
		io.sbx(
			[
				"exec",
				input.sandbox,
				"sh",
				"-c",
				'git -C "$1" bundle create "$2" "refs/heads/$3"',
				"--",
				entry.workspace,
				guestBundle,
				checkout.branch,
			],
			{ quiet: true },
		);
		io.sbx(["cp", `${input.sandbox}:${guestBundle}`, bundle], { quiet: true });
		io.git(["bundle", "verify", bundle], entry.repo);
		const [head, ref] = io
			.git(
				["bundle", "list-heads", bundle, `refs/heads/${entry.branch}`],
				entry.repo,
			)
			.split(/\s+/);
		if (head !== checkout.head || ref !== `refs/heads/${entry.branch}`)
			throw new Error(
				`${entry.name}: bundle head changed after the sandbox checkout was probed; nothing was imported`,
			);
		return { entry, checkout, bundle, imported };
	});
	for (const { entry, checkout, bundle, imported } of ready) {
		if (imported) continue;
		try {
			io.git(
				[
					"fetch",
					"--quiet",
					bundle,
					`refs/heads/${entry.branch}:refs/heads/${entry.branch}`,
				],
				entry.repo,
			);
			entry.sourceSha = checkout.head;
			entry.landedSha = io.git(
				["rev-parse", `refs/heads/${entry.branch}`],
				entry.repo,
			);
			saveRepositories(input.sandbox, task, manifest, io);
			io.log(
				`${entry.name}: ${entry.branch} <- ${input.sandbox} source ${checkout.head} host ${entry.landedSha}`,
			);
		} catch (error) {
			const progress = manifest.repositories
				.map(
					(repo) =>
						`${repo.name}: ${repo.landedSha ? `host ${repo.landedSha}` : `pending in ${input.sandbox}`}`,
				)
				.join("; ");
			throw new Error(
				`${entry.name} import refused; ${progress}\n${(error as Error).message}`,
			);
		}
	}
	if (input.sign)
		for (const entry of manifest.repositories) {
			if (!entry.landedSha)
				throw new Error(`${entry.name}: import all repositories before signing`);
			if (entry.signedSha === entry.landedSha) continue;
			try {
				const published = io
					.git(["ls-remote", "--heads", "origin", entry.branch], entry.repo)
					.trim()
					.split(/\s+/)[0];
				if (entry.pushedSha && !published)
					throw new Error(
						`${entry.name}: the previously published branch is missing; refusing to rewrite it`,
					);
				if (published) {
					io.git(["fetch", "--quiet", "origin", entry.branch], entry.repo);
					try {
						io.git(
							["merge-base", "--is-ancestor", published, entry.landedSha],
							entry.repo,
						);
					} catch {
						throw new Error(
							`${entry.name}: the published branch ${published} is not an ancestor of ${entry.landedSha}`,
						);
					}
				}
				sign(
					entry.repo,
					entry.branch,
					published ? [`origin/${entry.base}`, published] : [`origin/${entry.base}`],
					io,
				);
				entry.landedSha = io.git(
					["rev-parse", `refs/heads/${entry.branch}`],
					entry.repo,
				);
				entry.signedSha = entry.landedSha;
				saveRepositories(input.sandbox, task, manifest, io);
				io.log(
					`${entry.name}: signed ${entry.landedSha} on the Mac; resync the sandbox before editing again`,
				);
			} catch (error) {
				const progress = manifest.repositories
					.map(
						(repo) =>
							`${repo.name}: ${repo.signedSha ? `signed ${repo.signedSha}` : `host ${repo.landedSha ?? "pending"}`}`,
					)
					.join("; ");
				throw new Error(
					`${entry.name} signing stopped; ${progress}\n${(error as Error).message}`,
				);
			}
		}
	if (input.push) {
		const remotes = manifest.repositories.map((entry) => {
			if (!entry.landedSha)
				throw new Error(`${entry.name}: import all repositories before pushing`);
			const remote = io
				.git(["ls-remote", "--heads", "origin", entry.branch], entry.repo)
				.trim()
				.split(/\s+/)[0];
			if (remote && remote !== entry.landedSha) {
				io.git(["fetch", "--quiet", "origin", entry.branch], entry.repo);
				try {
					io.git(
						["merge-base", "--is-ancestor", remote, entry.landedSha],
						entry.repo,
					);
				} catch {
					throw new Error(
						`${entry.name}: origin/${entry.branch} no longer fast-forwards to ${entry.landedSha}; no push made`,
					);
				}
			}
			return remote;
		});
		for (const [index, entry] of manifest.repositories.entries()) {
			if (remotes[index] === entry.landedSha) {
				entry.pushedSha = entry.landedSha;
				saveRepositories(input.sandbox, task, manifest, io);
				continue;
			}
			try {
				push(entry.repo, entry.branch, io);
				entry.pushedSha = entry.landedSha;
				saveRepositories(input.sandbox, task, manifest, io);
				io.log(`${entry.name}: ${entry.pushedSha} reached GitHub`);
			} catch (error) {
				const progress = manifest.repositories
					.map(
						(repo) =>
							`${repo.name}: ${repo.pushedSha === repo.landedSha ? `GitHub ${repo.pushedSha}` : `host ${repo.landedSha}`}`,
					)
					.join("; ");
				throw new Error(
					`${entry.name} push refused; ${progress}\n${(error as Error).message}`,
				);
			}
		}
	}
}

function remoteBranch(
	repo: string,
	branch: string,
	io: Io,
): string | undefined {
	try {
		io.git(["fetch", "--quiet", "origin", branch], repo);
	} catch {
		io.log(
			`${repo}: origin/${branch} could not refresh; checking its cached ref`,
		);
	}
	try {
		return io.git(["rev-parse", "--verify", "--quiet", `origin/${branch}`], repo)
			? `origin/${branch}`
			: undefined;
	} catch {
		return undefined;
	}
}

function push(repo: string, branch: string, io: Io): void {
	try {
		io.git(["push", "--quiet", "-u", "origin", branch], repo);
	} catch (error) {
		throw new Error(
			`${branch} stayed local: ${(error as Error).message}\nthe branch is no longer a fast-forward of origin; forcing it is your own command`,
		);
	}
	io.log(`${branch} -> origin`);
}

function sign(repo: string, branch: string, published: string[], io: Io): void {
	const commits = io
		.git(["rev-list", "--reverse", branch, "--not", ...published], repo)
		.split("\n")
		.filter(Boolean);
	if (!commits.length) return;
	const worktree = `${io.tmp}/fleet-sign-${branch.replace(/[^a-z0-9_-]+/gi, "-")}`;
	if (io.stat(worktree))
		throw new Error(
			`${worktree} holds a previous signing attempt; resolve it before signing again`,
		);
	io.git(["worktree", "prune"], repo);
	io.git(["worktree", "add", "--quiet", "--detach", worktree, commits[0]], repo);
	try {
		io.git(
			["commit", "--quiet", "--amend", "--no-edit", "--allow-empty", "-S"],
			worktree,
		);
		const first = io.git(["rev-parse", "HEAD"], worktree);
		if (commits.length > 1) {
			io.git(
				[
					"rebase",
					"--quiet",
					"--onto",
					first,
					commits[0],
					branch,
					"--exec",
					"git commit --quiet --amend --no-edit --allow-empty -S",
				],
				worktree,
			);
		}
		io.git(
			[
				"update-ref",
				`refs/heads/${branch}`,
				io.git(["rev-parse", "HEAD"], worktree),
			],
			repo,
		);
		io.log(`${commits.length} commit(s) signed on ${branch}`);
	} catch (error) {
		try {
			io.git(["rebase", "--abort"], worktree);
		} catch {}
		throw error;
	} finally {
		io.git(["worktree", "remove", "--force", worktree], repo);
	}
}
