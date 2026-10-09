import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { realIo } from "../fleet/io.ts";
import { render } from "./render.ts";

const root = resolve(import.meta.dirname, "../..");
const sha = "a".repeat(40);
const cases = [
	{ name: "pending", pending: 1, state: "pending", exit: 1, reads: 20 },
	{ name: "settled success", pending: 0, state: "success", exit: 0, reads: 1 },
	{ name: "settled failure", pending: 0, state: "failure", exit: 0, reads: 1 },
	{ name: "unavailable read", pending: 0, state: "unavailable", exit: 2, reads: 1 },
];

for (const agent of ["pi", "claude"] as const) {
	for (const fixture of cases) {
		test(`${agent} rendered CI wait handles ${fixture.name}`, (t) => {
			const out = mkdtempSync(join(tmpdir(), `ci-contract-${agent}-`));
			t.after(() => rmSync(out, { recursive: true, force: true }));
			render({ root, agent, seat: "container", out }, { ...realIo(out), log: () => {} });
			const skill = readFileSync(join(out, "home/skills/babysit-pr/SKILL.md"), "utf8");
			const command = skill.match(/^ci-wait .+$/m);
			assert.ok(command, "rendered skill must supply the invocation");
			const third = skill.match(/pass `([^`]+)` as its third argument/);
			const invocation = command[0]
				.replace("<owner>/<repo>", "o/r")
				.replace("<number>", "7") + (third ? ` ${third[1]}` : "");
			symlinkSync(join(out, "context/container/ci-wait.sh"), join(out, "ci-wait"));
			writeFileSync(join(out, "sleep"), '#!/bin/sh\nprintf "%s\\n" "$1" >> "$WAITS"\n', { mode: 0o755 });
			writeFileSync(join(out, "waits"), "");
			writeFileSync(join(out, "gh"), `#!/bin/sh
case "$*" in
  *headRefOid*) echo '${sha}' ;;
  *"run list"*"select"*) echo '${fixture.pending}' ;;
  *"run list"*"--jq length"*) echo 2 ;;
  *"run list"*) echo '[{"name":"tests","status":"completed","conclusion":"${fixture.state}","url":"https://example.invalid/run/1"}]' ;;
  *"--jq .state"*)
    if [ '${fixture.state}' = unavailable ]; then echo 'read unavailable' >&2; exit 1; fi
    echo '${fixture.state}' ;;
  *"api repos/"*) echo '{"state":"${fixture.state}","contexts":[{"context":"review","state":"${fixture.state}"}]}' ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
			const env = { ...process.env, PATH: `${out}:${process.env.PATH}`, WAITS: join(out, "waits") };
			Reflect.deleteProperty(env, "CI_WAIT_INTERVAL");

			const run = spawnSync("bash", ["-c", invocation], { encoding: "utf8", env, timeout: 10000 });

			const output = run.stdout + run.stderr;
			assert.equal(run.error, undefined);
			assert.equal(run.status, fixture.exit, `${invocation}\n${output}`);
			assert.doesNotMatch(output, /usage: ci-wait/);
			assert.equal((output.match(/^read \d+\/20:/gm) ?? []).length, fixture.reads);
			assert.deepEqual(readFileSync(join(out, "waits"), "utf8").trim().split("\n"), Array(fixture.reads).fill("60"));
			if (fixture.state === "pending") assert.match(output, /still pending after 20 reads/);
			else if (fixture.state === "unavailable") assert.match(output, /read failed, stop waiting/);
			else {
				assert.match(output, new RegExp(`"conclusion":"${fixture.state}"`));
				assert.match(output, new RegExp(`"state":"${fixture.state}"`));
			}
		});
	}
}
