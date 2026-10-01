import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = new URL("../../sbx/build.sh", import.meta.url).pathname;

function tool(bin: string, name: string, body: string): void {
	writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
	chmodSync(join(bin, name), 0o755);
}

test("the image home takes the person's git directory as it is", () => {
	const root = mkdtempSync(join(tmpdir(), "build-"));
	const home = join(root, "home");
	const git = join(home, ".fleet/config/git");
	mkdirSync(join(git, ".config/git"), { recursive: true });
	writeFileSync(join(git, ".gitconfig"), "[user]\n\tname = Alice\n");
	writeFileSync(join(git, ".gitconfig-work"), "[user]\n\tname = Alice W\n");
	writeFileSync(join(git, ".config/git/allowed_signers"), "alice ssh-ed25519 AAAA\n");
	const rendered = join(root, "rendered");
	mkdirSync(join(rendered, "home"), { recursive: true });
	mkdirSync(join(rendered, "context"));
	const bin = join(root, "bin");
	const seen = join(root, "seen");
	mkdirSync(bin);
	tool(bin, "pi", "echo 1.0.0");
	tool(bin, "sbx", "exit 0");
	tool(
		bin,
		"docker",
		`for arg; do case "$arg" in pi-home=*) (cd "\${arg#pi-home=}" && find . -type f | sort | while read -r f; do printf '%s %s\\n' "$f" "$(head -n 2 "$f" | tail -n 1)"; done) > ${seen};; esac; done`,
	);

	const run = spawnSync("bash", [script, "pi", "my-pi:v1", rendered], {
		encoding: "utf8",
		env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root },
	});

	assert.equal(run.status, 0, run.stderr);
	assert.equal(
		readFileSync(seen, "utf8"),
		[
			"./git/.config/git/allowed_signers alice ssh-ed25519 AAAA",
			"./git/.gitconfig \tname = Alice",
			"./git/.gitconfig-work \tname = Alice W",
			"",
		].join("\n"),
	);
});

test("each agent Dockerfile copies the git directory into the home once and names no git file", () => {
	for (const harness of ["pi", "claude"]) {
		const dockerfile = readFileSync(new URL(`../../${harness}/sbx/Dockerfile`, import.meta.url), "utf8");

		assert.deepEqual(
			dockerfile.match(/^COPY .*\bgit\/.*$/gm),
			[`COPY --from=${harness}-home --chown=agent:agent git/ /home/agent/`],
			harness,
		);
		assert.doesNotMatch(dockerfile, /gitconfig|allowed_signers/, harness);
	}
});
