import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SEATS } from "../harness.ts";
import { realIo } from "./io.ts";

test("an sbx call that hangs past its limit fails with the command it ran", (t) => {
	const bin = mkdtempSync(join(tmpdir(), "sbx-"));
	writeFileSync(join(bin, "sbx"), "#!/bin/sh\nsleep 5\n");
	chmodSync(join(bin, "sbx"), 0o755);
	const path = process.env.PATH;
	process.env.PATH = `${bin}:${path}`;
	t.after(() => { process.env.PATH = path; });

	assert.throws(() => realIo("/home/me", SEATS.pi).sbx(["ls", "--json"], { quiet: true, timeoutMs: 200 }), /^Error: sbx ls --json gave no answer within 0.2s$/);
});
