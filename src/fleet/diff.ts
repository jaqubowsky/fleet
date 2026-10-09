import { dirname, resolve } from "node:path";
import { agentName } from "./name.ts";
import type { Io } from "./io.ts";
import { repositoryManifest } from "./repositories.ts";
import { sandboxes, type Agent } from "./status.ts";

export type DiffFile = { path: string; status: string; line: number };
export type DiffSnapshot = {
	status: string;
	repositories: string[];
	repository: string;
	files: DiffFile[];
	patch: string;
	base?: string;
};
export type DiffPosition = { repository: string; scope: string; path: string; offset: number };
type Pane = { pane_id: string; tab_id: string; workspace_id: string; title?: string };

export const DIFF_PROBE = String.raw`
const { execFileSync } = require('node:child_process');
const { lstatSync } = require('node:fs');
const { workspace, scope, base: requestedBase } = JSON.parse(process.argv[1]);
process.chdir(workspace || process.env.WORKSPACE_DIR);
const git = args => execFileSync('git', ['--no-pager', '--literal-pathspecs', '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const target = scope === 'uncommitted' ? 'HEAD' : requestedBase || git(['symbolic-ref', 'refs/remotes/origin/HEAD']).trim();
const base = scope === 'uncommitted' ? 'HEAD' : git(['merge-base', target, 'HEAD']).trim();
const options = ['--no-color', '--no-ext-diff', '--no-textconv', '--no-renames'];
const names = git(['diff', ...options, '--name-status', '-z', base, '--']).split('\0');
const files = [];
for (let i = 0; i + 1 < names.length; i += 2) files.push({ status: names[i], path: names[i + 1] });
for (const path of git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) files.push({ status: '?', path });
files.sort((a, b) => a.path.localeCompare(b.path));
let patch = '';
let line = 0;
for (const file of files) {
  const path = file.path;
  let body = '';
  const stat = file.status === 'D' ? undefined : lstatSync(path);
  if (stat && stat.size > 4 * 1024 * 1024) body = 'File exceeds 4 MiB. Inspect it separately.';
  else if (file.status === '?' && !stat.isFile()) body = 'Untracked non-regular file. Content not read.';
  else if (file.status === '?') {
    try { body = git(['diff', ...options, '--no-index', '--', '/dev/null', path]); }
    catch (error) { if (error.status !== 1) throw error; body = error.stdout; }
  } else body = git(['diff', ...options, base, '--', path]);
  body = body.trimEnd();
  file.line = line;
  line += body.split('\n').length;
  patch += body + '\n';
}
process.stdout.write(JSON.stringify({ files, patch, base: target.replace('refs/remotes/', '') }));
`;

export function diffSnapshot(name: string, position: Pick<DiffPosition, "repository" | "scope">, io: Io): DiffSnapshot {
	const sandbox = sandboxes(io).find(s => s.name === name);
	const repositories = repositoryManifest(name, io)?.repositories ?? [];
	const repository = repositories.find(r => r.repo === position.repository) ?? repositories[0];
	const empty = { repositories: repositories.map(r => r.repo), repository: repository?.repo ?? "", files: [], patch: "" };
	if (!sandbox) return { ...empty, status: "Container removed" };
	if (sandbox.status !== "running") return { ...empty, status: `Container ${sandbox.status}` };
	const result = JSON.parse(io.sbx(["exec", name, "node", "-e", DIFF_PROBE, JSON.stringify({ workspace: repository?.workspace ?? "", scope: position.scope, base: repository ? `refs/remotes/origin/${repository.base}` : "" })], { quiet: true, timeoutMs: 15_000 }));
	return { ...empty, ...result, status: "Live" };
}

export function diffStatePath(name: string, io: Io): string {
	return `${io.home}/.fleet/cache/diff/${name}.json`;
}

export function toggleDiff(name: string | undefined, paneId: string | undefined, root: string, io: Io): void {
	const current = io.herdr<{ result: { pane: Pane } }>(["pane", "current", ...(paneId ? ["--pane", paneId] : ["--current"])]).result.pane;
	const statePath = `${io.home}/.fleet/cache/diff/panels/${current.tab_id}.json`;
	const saved = io.read(statePath);
	const panes = io.herdr<{ result: { panes: Pane[] } }>(["pane", "list", "--workspace", current.workspace_id]).result.panes;
	if (saved) {
		const state = JSON.parse(saved) as { pane: string; tab: string };
		if (panes.some(p => p.pane_id === state.pane && p.tab_id === state.tab)) {
			io.herdr(["pane", "close", state.pane]);
			io.remove(statePath);
			return;
		}
	}
	const all = sandboxes(io);
	const agents = io.herdr<{ result: { agents: Agent[] } }>(["agent", "list"]).result.agents;
	const tabs = io.herdr<{ result: { tabs: { tab_id: string; label: string }[] } }>(["tab", "list", "--workspace", current.workspace_id]).result.tabs;
	const tab = tabs.find(t => t.tab_id === current.tab_id);
	const matches = all.filter(s => name ? s.name === name || agentName(s.name) === name : agents.some(a => a.tab_id === current.tab_id && a.name === agentName(s.name)) || tab?.label === agentName(s.name));
	if (matches.length !== 1) throw new Error("Select a Fleet container tab, or run fleet diff <sandbox> from the target pane");
	const sandbox = matches[0];
	const panel = io.herdr<{ result: { pane: Pane } }>(["pane", "split", current.pane_id, "--direction", "right", "--ratio", "0.6", "--no-focus"]).result.pane;
	io.mkdir(dirname(statePath));
	io.write(statePath, JSON.stringify({ pane: panel.pane_id, tab: current.tab_id }));
	io.herdr(["pane", "rename", panel.pane_id, `Changes: ${sandbox.name}`]);
	const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
	io.herdr(["pane", "run", panel.pane_id, `${quote(resolve(root, "bin/fleet"))} diff ${quote(sandbox.name)} --view`]);
}
