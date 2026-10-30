import { checkouts, withoutTerminalControls } from "./checkout.ts";
import type { Io } from "./io.ts";

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
	const reads = checkouts(name, io);
	if (!reads) return undefined;
	return withoutTerminalControls(
		reads
			.map(read => JSON.parse(io.sbx(["exec", name, "node", "-e", DIFF_PROBE, JSON.stringify(read)], { quiet: true, timeoutMs: 15_000 })) as string)
			.join(""),
	);
}
