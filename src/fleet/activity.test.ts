import assert from "node:assert/strict";
import { test } from "node:test";
import { activityOf, projection } from "./activity.ts";

const call = (at: string, tool: string, ok: boolean, agent = "main") => JSON.stringify({ at, tool, ok, agent });

test("the projection reads elapsed, silent minutes, tool calls, last tool, failure streak and cost from the activity log", () => {
	const log = [
		call("2026-09-26T10:00:00Z", "Read", true),
		call("2026-09-26T10:20:00Z", "Bash", false),
		call("2026-09-26T10:30:00Z", "Bash", false),
		call("2026-09-26T10:40:00Z", "Bash", false),
		"",
	].join("\n");

	const text = projection(activityOf(log), 4.123, new Date("2026-09-26T11:25:00Z"));

	assert.equal(text, "up 1h 25m, silent 45m, 4 tool calls, last Bash, 3 failed in a row, $4.12");
});

test("a sub-agent's success does not break the streak of the agent still failing", () => {
	const log = [
		call("2026-09-26T10:00:00Z", "Bash", false),
		call("2026-09-26T10:01:00Z", "Read", true, "a1"),
		call("2026-09-26T10:02:00Z", "Bash", false),
		call("2026-09-26T10:03:00Z", "Grep", false, "a1"),
	].join("\n");

	const activity = activityOf(log);

	assert.equal(activity?.streak, 2);
	assert.equal(projection(activity, undefined, new Date("2026-09-26T10:03:00Z")), "up 3m, silent 0m, 4 tool calls, last Grep, 2 failed in a row");
});

test("a success after failures ends the streak, and no log leaves only the cost", () => {
	const log = [call("2026-09-26T10:00:00Z", "Bash", false), call("2026-09-26T10:01:00Z", "Bash", true)].join("\n");

	assert.equal(activityOf(log)?.streak, 0);
	assert.equal(activityOf(undefined), undefined);
	assert.equal(projection(undefined, 0.5, new Date()), "$0.50");
	assert.equal(projection(undefined, undefined, new Date()), "");
});
