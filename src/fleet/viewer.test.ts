import assert from "node:assert/strict";
import { test } from "node:test";
import { SEATS } from "../harness.ts";
import { fakeIo } from "./fake-io.ts";
import { benchView } from "./viewer.ts";

const bench = "/home/me/.fleet/bench";
const dir = { size: 0, mtime: new Date(0), dir: true };
const file = { size: 1, mtime: new Date(0), dir: false };

function viewIo() {
	const io = fakeIo(
		{
			[`list ${bench}/runs`]: ["b30d", "b3b"],
			[`list ${bench}/runs/b30d`]: ["t1-1"],
			[`list ${bench}/runs/b3b`]: ["t1-1"],
			[`list ${bench}/runs/b3b/t1-1/claude-webapp-b3b-t1-1/browser`]: ["walk-1"],
			[`stat ${bench}/runs/b3b/t1-1/claude-webapp-b3b-t1-1/browser/walk-1`]: dir,
			[`list ${bench}/runs/b3b/t1-1/claude-webapp-b3b-t1-1/browser/walk-1`]: ["01.png", "report.md"],
			[`stat ${bench}/runs/b3b/t1-1/claude-webapp-b3b-t1-1/browser/walk-1/01.png`]: file,
			[`stat ${bench}/runs/b3b/t1-1/claude-webapp-b3b-t1-1/browser/walk-1/report.md`]: file,
		},
		SEATS.claude,
	);
	const result = (tag: string, status: string) =>
		JSON.stringify({ task: "t1", rep: 1, status, task_dir: `claude-webapp-${tag}-t1-1`, closing_message: "Done. **Checks** pass.", diff: "diff.patch", usage: "usage.json", judge: "judge.json", actions: { screenshots_read: { main: tag === "b3b" ? 4 : 9, subagents: 1 }, browser_runs: 2 } });
	for (const [tag, status] of [["b30d", "done"], ["b3b", "blocked"]]) {
		io.files[`${bench}/runs/${tag}/t1-1/result.json`] = result(tag, status);
		io.files[`${bench}/runs/${tag}/t1-1/usage.json`] = JSON.stringify({ totals: { requests: tag === "b3b" ? 120 : 200, cost: tag === "b3b" ? 9.5 : 14.25, cached_input: 1000, output: 10 } });
		io.files[`${bench}/runs/${tag}/t1-1/judge.json`] = JSON.stringify({ verdict: tag === "b3b" ? "merge_after_fix" : "merge", passes: [{ verdict: "merge", reasons: "fixed", fix: "", rubric: [{ item: "root cause", met: "yes", why: "query" }], false_claims: [] }] });
		io.files[`${bench}/runs/${tag}/t1-1/diff.patch`] = "+<script>alert(1)</script>\n";
	}
	io.files[`${bench}/runs/b3b/t1-1/claude-webapp-b3b-t1-1/browser/walk-1/report.md`] = "# Walk\n\nCriterion 1 holds.\n";
	io.files[`${bench}/controls/t1/judge.json`] = JSON.stringify({ verdict: "merge" });
	return io;
}

test("the index sets every task against every tag with status, verdict, cost, requests and screenshots, plus the merged pull request's verdict", () => {
	const io = viewIo();

	const index = benchView(io);

	assert.equal(index, `${bench}/view/index.html`);
	const html = io.files[index];
	assert.match(html, /<th>b30d<\/th>\s*<th>b3b<\/th>/);
	assert.match(html, /done[\s\S]*merge[\s\S]*\$14\.25[\s\S]*200 requests[\s\S]*10 screenshots/);
	assert.match(html, /blocked[\s\S]*merge after fix[\s\S]*\$9\.50[\s\S]*120 requests[\s\S]*5 screenshots/);
	assert.match(html, /merged pull request: merge/);
	assert.match(html, /href="b3b\/t1-1\.html"/);
});

test("a run page renders the closing message and reports, escapes the diff, and shows each frame from its run directory", () => {
	const io = viewIo();

	benchView(io);

	const page = io.files[`${bench}/view/b3b/t1-1.html`];
	assert.match(page, /<strong>Checks<\/strong>/);
	assert.match(page, /<h1>Walk<\/h1>/);
	assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
	assert.ok(!page.includes("<script>alert"), "the diff is escaped");
	assert.match(page, /<img src="\.\.\/\.\.\/runs\/b3b\/t1-1\/claude-webapp-b3b-t1-1\/browser\/walk-1\/01\.png"/);
	assert.match(page, /root cause[\s\S]*yes/);
});
