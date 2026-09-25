import { repoName } from "../profile/profile.ts";
import type { Io } from "./io.ts";
import { repoProfile } from "./permissions.ts";
import { checkoutProbe, parseCheckout } from "./status.ts";

export type LandInput = { sandbox: string; repo: string; root: string; sign?: boolean; push?: boolean; branch?: string };

export function baseBranch(repo: string, io: Io): string {
	for (const candidate of ["origin/HEAD", "origin/main", "origin/master", "main", "master"]) {
		try {
			io.git(["rev-parse", "--verify", "--quiet", candidate], repo);
			return candidate === "origin/HEAD" ? io.git(["rev-parse", "--abbrev-ref", "origin/HEAD"], repo) : candidate;
		} catch {}
	}
	throw new Error(`no base branch in ${repo}`);
}

export function isBase(base: string, branch: string): boolean {
	return base === branch || base.endsWith(`/${branch}`);
}

export function landRefusal(checkout: { branch: string; dirty: number }, current: string, base: string): string | undefined {
	if (checkout.dirty) return `${checkout.dirty} uncommitted file(s) in the container on ${checkout.branch}; commit or discard there first`;
	if (!checkout.branch) return "container is on a detached HEAD";
	if (isBase(base, checkout.branch)) return `${checkout.branch} is the base branch; give the work its own branch in the container first`;
	if (checkout.branch === current) return `${checkout.branch} is checked out in the local repository; switch away first`;
	return undefined;
}

export function land(input: LandInput, io: Io): void {
	const checkout = parseCheckout(io.sbx(["exec", input.sandbox, "sh", "-c", checkoutProbe], { quiet: true }));
	const branch = input.branch ?? checkout.branch;
	const base = baseBranch(input.repo, io);
	const current = io.git(["branch", "--show-current"], input.repo);
	const refusal = landRefusal({ ...checkout, branch }, current, base);
	if (refusal) throw new Error(refusal);
	const { host } = repoProfile(input.root, repoName(io.git(["remote", "get-url", "origin"], input.repo)), io);
	if (input.push && host.push === "none") throw new Error("this repository's profile gives the host no push (host.push is none in host/repos.json); the branch reaches GitHub another way");
	const signs = input.sign || host.sign !== "none";

	try {
		io.git(["fetch", "--quiet", `sandbox-${input.sandbox}`, `${branch}:${branch}`], input.repo);
	} catch (error) {
		const message = (error as Error).message;
		if (!/\[rejected\]|non-fast-forward/.test(message)) throw error;
		throw new Error(`${branch} in the container is not a descendant of the one here, so importing it would drop what this repo already holds, signatures included\n${message}\nresync the container with git fetch origin && git reset --hard origin/${branch}, or delete ${branch} here when the container's history is the one you want`);
	}
	const remote = signs || input.push;
	if (remote && base.startsWith("origin/")) io.git(["fetch", "--quiet", "origin", base.slice("origin/".length)], input.repo);
	const pushed = remote ? remoteBranch(input.repo, branch, io) : undefined;

	io.log(`${branch} <- ${input.sandbox} (base ${base})`);
	io.log(io.git(["--no-pager", "log", "--format=%h %G? %s", `${base}..${branch}`], input.repo));
	io.log(io.git(["--no-pager", "diff", "--stat", `${base}...${branch}`], input.repo));

	if (signs) sign(input.repo, branch, pushed ? [base, pushed] : [base], io);
	else io.log(`unsigned commits stay unsigned; rerun with --sign to sign them (one Touch ID tap per commit)`);

	if (input.push) push(input.repo, branch, io);
}

function remoteBranch(repo: string, branch: string, io: Io): string | undefined {
	try {
		io.git(["fetch", "--quiet", "origin", branch], repo);
	} catch {}
	try {
		return io.git(["rev-parse", "--verify", "--quiet", `origin/${branch}`], repo) ? `origin/${branch}` : undefined;
	} catch {
		return undefined;
	}
}

function push(repo: string, branch: string, io: Io): void {
	try {
		io.git(["push", "--quiet", "-u", "origin", branch], repo);
	} catch (error) {
		throw new Error(`${branch} stayed local: ${(error as Error).message}\nthe branch is no longer a fast-forward of origin; forcing it is your own command`);
	}
	io.log(`${branch} -> origin`);
}

function sign(repo: string, branch: string, published: string[], io: Io): void {
	const commits = io.git(["rev-list", "--reverse", branch, "--not", ...published], repo).split("\n").filter(Boolean);
	if (!commits.length) return;
	const worktree = `${io.tmp}/fleet-sign-${branch.replace(/[^a-z0-9_-]+/gi, "-")}`;
	try { io.git(["worktree", "remove", "--force", worktree], repo); } catch {}
	io.git(["worktree", "prune"], repo);
	io.git(["worktree", "add", "--quiet", "--detach", worktree, commits[0]], repo);
	try {
		io.git(["-c", "core.hooksPath=/dev/null", "commit", "--quiet", "--amend", "--no-edit", "--no-verify", "--allow-empty", "-S"], worktree);
		const first = io.git(["rev-parse", "HEAD"], worktree);
		if (commits.length > 1) {
			io.git(["-c", "core.hooksPath=/dev/null", "rebase", "--quiet", "--onto", first, commits[0], branch, "--exec", "git -c core.hooksPath=/dev/null commit --quiet --amend --no-edit --no-verify --allow-empty -S"], worktree);
		}
		io.git(["update-ref", `refs/heads/${branch}`, io.git(["rev-parse", "HEAD"], worktree)], repo);
		io.log(`${commits.length} commit(s) signed on ${branch}`);
	} finally {
		try { io.git(["rebase", "--abort"], worktree); } catch {}
		io.git(["worktree", "remove", "--force", worktree], repo);
	}
}
