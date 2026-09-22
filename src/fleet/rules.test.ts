import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SEATS = /\b(host|container|containers|sandbox|sandboxes|sbx|fleet|herdr)\b/i;
const root = new URL("../../", import.meta.url).pathname;

for (const file of ["rules/core.md", "rules/delegation.md"]) {
	test(`${file} names no seat`, () => {
		const offenders = readFileSync(`${root}${file}`, "utf8")
			.split("\n")
			.filter((line) => SEATS.test(line));
		assert.deepEqual(offenders, [], `a seat belongs in rules/host.md or sbx/container/sandbox.md`);
	});
}
