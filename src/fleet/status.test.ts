import assert from "node:assert/strict";
import { test } from "node:test";
import { agentFor, brief, elapsed, fleetSandboxes, formatRows, parseCheckout, wake } from "./status.ts";

test("only pi- sandboxes belong to the fleet", () => {
	const all = { sandboxes: [{ name: "claude-x", status: "running", workspaces: [] }, { name: "pi-webapp-a", status: "stopped", workspaces: ["/r"] }] };
	assert.deepEqual(fleetSandboxes(all, "pi-").map((s) => s.name), ["pi-webapp-a"]);
});

test("checkout probe output parses branch, dirty count and head", () => {
	assert.deepEqual(parseCheckout("web-1\t3\tabc"), { branch: "web-1", dirty: 3, head: "abc" });
	assert.deepEqual(parseCheckout(""), { branch: "", dirty: 0, head: "" });
});

test("agent lookup by name", () => {
	assert.equal(agentFor([{ pane_id: "w1:p1", name: "a", agent_status: "idle" }], "a")?.agent_status, "idle");
	assert.equal(agentFor([], "a"), undefined);
});

test("rows render aligned with dirty count only when dirty", () => {
	const out = formatRows([
		{ sandbox: "pi-a", status: "running", agent: "idle", branch: "main", dirty: 0 },
		{ sandbox: "pi-long-name", status: "running", agent: "gone", branch: "x", dirty: 2 },
	]);
	assert.equal(out, "pi-a          running  idle     main\npi-long-name  running  gone     x  2 uncommitted");
	assert.equal(formatRows([]), "no fleet containers");
});

test("a garbled dirty count reads as zero rather than NaN", () => {
	assert.equal(parseCheckout("main\tabc\tdef").dirty, 0);
});

test("missing sections are explicit and legacy now and log stay out", () => {
	const status = "status: implementing\nattention: none\nnow: stale step\n\n## Log\n- old detail\n";

	assert.equal(brief(status), "status: implementing\nattention: none\nsummary: not recorded\nnext step: not recorded");
	assert.equal(brief(undefined), "status: no status.md\nattention: not recorded\nsummary: not recorded\nnext step: not recorded");
});

test("a status brief carries summary and continuation without copying the log", () => {
	const status = "status: implementing\nattention: none\n\n## Summary\nThe regression is reproduced. The fix awaits review; see [analysis](analysis.md).\n\n## Next step\nRun two-axis-review against abc1234.\n\n## Log\n- analysis: reproduced; analysis.md\n- fix: green; commit abc1234\n";

	assert.equal(brief(status), "status: implementing\nattention: none\nsummary: The regression is reproduced. The fix awaits review; see [analysis](analysis.md).\nnext step: Run two-axis-review against abc1234.");
});

test("a wake projects status and commits, and no log line the host already saw", () => {
	const status = "status: done\nattention: none\n\n## Summary\nThe fix passes.\nReview is complete; see review.md.\n\n## Next step\nWait for the host.\n\n## Log\n- internal detail\n";

	assert.equal(
		wake(status, "abc1234 fix(documents): exclude rebookings\n", ["- internal detail"]),
		"status: done\nattention: none\nsummary: The fix passes. Review is complete; see review.md.\nnext step: Wait for the host.\ncommits: abc1234 fix(documents): exclude rebookings",
	);
	assert.equal(wake(undefined, ""), "status: no status.md\nattention: not recorded\nsummary: not recorded\nnext step: not recorded\ncommits: none");
});

test("a wake carries the log lines written since the previous wake", () => {
	const status = "status: implementing\nattention: none\n\n## Summary\nx\n\n## Next step\ny\n\n## Log\n- Scope set; analysis.md\n- Baseline build passed; logs/initial-build.log\n- Decided: keep the stacked layout under 860 px, because the ticket covers wide screens only; analysis.md\n";

	const result = wake(status, "", ["- Scope set; analysis.md"]);

	assert.equal(
		result,
		"status: implementing\nattention: none\nsummary: x\nnext step: y\nlog since last wake:\n- Baseline build passed; logs/initial-build.log\n- Decided: keep the stacked layout under 860 px, because the ticket covers wide screens only; analysis.md\ncommits: none",
	);
});

test("a wake shows the latest five new log lines, each cut to 200 characters, and counts the ones before them", () => {
	const status = `status: implementing\n\n## Log\n${Array.from({ length: 7 }, (_, i) => `- step ${i + 1}`).join("\n")}\n- ${"x".repeat(500)}\n`;

	const result = wake(status, "", []);

	assert.match(result, new RegExp(`\\nlog since last wake \\(3 earlier in status\\.md\\):\\n- step 4\\n- step 5\\n- step 6\\n- step 7\\n- ${"x".repeat(195)}\\.\\.\\.\\ncommits: none$`));
});

test("a wake from a watch that has not shown this container before calls its log lines the latest, not new", () => {
	const status = "status: implementing\n\n## Log\n- Scope set; analysis.md\n";

	assert.match(wake(status, ""), /\nlog \(latest\):\n- Scope set; analysis\.md\n/);
});

test("a log line written again word for word still reaches the wake", () => {
	const status = "status: implementing\n\n## Log\n- Gate passed; logs/gate.log\n- Commit a1\n- Gate passed; logs/gate.log\n";

	const result = wake(status, "", ["- Gate passed; logs/gate.log", "- Commit a1"]);

	assert.match(result, /\nlog since last wake:\n- Gate passed; logs\/gate\.log\ncommits: none$/);
});

test("a wake bounds every status field and commit list", () => {
	const status = `status: ${"s".repeat(500)}\nattention: ${"a".repeat(500)}\n\n## Summary\n${"b".repeat(5000)}\n\n## Next step\n${"n".repeat(1000)}\n\n## Log\nsecret log detail\n`;
	const commits = Array.from({ length: 10 }, (_, i) => `${i} ${"c".repeat(500)}`).join("\n");

	const result = wake(status, commits);

	assert.equal(result.split("\n").length, 5);
	assert.ok(result.length < 2000);
	assert.match(result, /summary: b+\.\.\.\nnext step: n+\.\.\./);
	assert.doesNotMatch(result, /secret log detail|5 c|last:|review:/);
});

test("rows carry the elapsed time and cost when the sessions give them", () => {
	const out = formatRows([
		{ sandbox: "pi-a", status: "running", agent: "working", branch: "web-1", dirty: 0, age: "1h 05m", cost: "$0.42" },
		{ sandbox: "pi-b", status: "stopped", agent: "gone", branch: "?", dirty: 0 },
	]);

	assert.equal(out, "pi-a  running  working  web-1  1h 05m  $0.42\npi-b  stopped  gone     ?");
});

test("elapsed time reads as hours and minutes", () => {
	assert.equal(elapsed(new Date("2026-09-16T09:30:00Z"), new Date("2026-09-16T10:35:00Z")), "1h 05m");
	assert.equal(elapsed(new Date("2026-09-16T10:31:00Z"), new Date("2026-09-16T10:35:00Z")), "4m");
});
