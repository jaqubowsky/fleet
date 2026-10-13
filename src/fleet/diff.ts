import { basename, dirname, resolve } from "node:path";
import type { Io } from "./io.ts";
import { repositoryManifest } from "./repositories.ts";
import { sandboxes, tabContainer } from "./status.ts";

type Pane = { pane_id: string; tab_id: string; workspace_id: string; title?: string };

export const DIFF_PROBE = String.raw`
const { execFileSync } = require('node:child_process');
const { lstatSync } = require('node:fs');
const { workspace, base: requestedBase, prefix } = JSON.parse(process.argv[1]);
process.chdir(workspace || process.env.WORKSPACE_DIR);
const git = args => execFileSync('git', ['--no-pager', '--literal-pathspecs', '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const target = requestedBase || git(['symbolic-ref', 'refs/remotes/origin/HEAD']).trim();
const base = git(['merge-base', target, 'HEAD']).trim();
const options = ['--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--src-prefix=a/' + prefix, '--dst-prefix=b/' + prefix];
const names = git(['diff', ...options, '--name-status', '-z', base, '--']).split('\0');
const files = [];
for (let i = 0; i + 1 < names.length; i += 2) files.push({ status: names[i], path: names[i + 1] });
for (const path of git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) files.push({ status: '?', path });
files.sort((a, b) => a.path.localeCompare(b.path));
let patch = '';
for (const file of files) {
  const path = file.path;
  const stat = file.status === 'D' ? undefined : lstatSync(path);
  let body = '';
  if (stat && (stat.size > 4 * 1024 * 1024 || (file.status === '?' && !stat.isFile()))) body = 'diff --git a/' + prefix + path + ' b/' + prefix + path;
  else if (file.status === '?') {
    try { body = git(['diff', ...options, '--no-index', '--', '/dev/null', path]); }
    catch (error) { if (error.status !== 1) throw error; body = error.stdout; }
  } else body = git(['diff', ...options, base, '--', path]);
  patch += body.endsWith('\n') ? body : body + '\n';
}
process.stdout.write(JSON.stringify(patch));
`;

export function containerPatch(name: string, io: Io): string | undefined {
	if (sandboxes(io).find(s => s.name === name)?.status !== "running") return undefined;
	const repositories = repositoryManifest(name, io)?.repositories ?? [];
	const reads = repositories.length
		? repositories.map(r => ({ workspace: r.workspace, base: `refs/remotes/origin/${r.base}`, prefix: repositories.length > 1 ? `${basename(r.repo)}/` : "" }))
		: [{ workspace: "", base: "", prefix: "" }];
	return reads
		.map(read => JSON.parse(io.sbx(["exec", name, "node", "-e", DIFF_PROBE, JSON.stringify(read)], { quiet: true, timeoutMs: 15_000 })) as string)
		.join("")
		.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
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
	const sandbox = tabContainer(name, current, io);
	if (!sandbox) throw new Error("Select a Fleet container tab, or run fleet diff <sandbox> from the target pane");
	const panel = io.herdr<{ result: { pane: Pane } }>(["pane", "split", current.pane_id, "--direction", "right", "--ratio", "0.6", "--no-focus"]).result.pane;
	io.mkdir(dirname(statePath));
	io.write(statePath, JSON.stringify({ pane: panel.pane_id, tab: current.tab_id }));
	io.herdr(["pane", "rename", panel.pane_id, `Changes: ${sandbox.name}`]);
	const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
	io.herdr(["pane", "run", panel.pane_id, `${quote(resolve(root, "bin/fleet"))} diff ${quote(sandbox.name)} --view`]);
}
