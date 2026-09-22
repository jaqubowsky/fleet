import assert from "node:assert/strict";
import { test } from "node:test";
import { agentFor, brief, elapsed, fleetSandboxes, formatRows, parseCheckout, wake } from "./status.ts";

test("only pi- sandboxes belong to the fleet", () => {
	const all = { sandboxes: [{ name: "claude-x", status: "running", workspaces: [] }, { name: "pi-webapp-a", status: "stopped", workspaces: ["/r"] }] };
	assert.deepEqual(fleetSandboxes(all).map((s) => s.name), ["pi-webapp-a"]);
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

test("a status brief is the header line plus the next open plan item", () => {
	const status = "status: implementing\nattention: none\npr: none\n\n## Plan\n- [x] restore endpoint\n- [ ] frontend error mapping\n- [ ] review\n";
	assert.equal(brief(status), "status: implementing | attention: none | pr: none\nnext: frontend error mapping");
	assert.equal(brief("status: done\n\n## Plan\n- [x] all\n"), "status: done\nnext: nothing left");
	assert.equal(brief(undefined), "status: no status.md");
});

test("a wake carries the status brief, the commits on the branch and the review verdict", () => {
	const status = "status: done\nattention: none\n\n## Plan\n- [x] fix\n";
	const review = "# Review\n\nCommit: abc\nRange: a...b\nVerdict: OK with notes\n";

	assert.equal(
		wake(status, review, "abc1234 fix(documents): exclude rebookings\n"),
		"status: done | attention: none\nnext: nothing left\ncommits: abc1234 fix(documents): exclude rebookings\nreview: OK with notes",
	);
	assert.equal(wake(status, undefined, ""), "status: done | attention: none\nnext: nothing left\ncommits: none");
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
