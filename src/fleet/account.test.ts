import assert from "node:assert/strict";
import { test } from "node:test";
import { activeAccount, useAccount } from "./account.ts";
import { fakeIo } from "./fake-io.ts";

function keychain(stored: Record<string, string> = {}) {
	return {
		stored,
		has: (name: string) => name in stored,
		read: (name: string) => stored[name],
		write: (name: string, value: string) => {
			stored[name] = value;
		},
	};
}

test("using an account puts its token behind the placeholder every sandbox sends to Anthropic", () => {
	const io = fakeIo();
	const accounts = keychain({ work: "work-token", private: "private-token" });
	const active = keychain();

	useAccount("private", { accounts, active }, io);

	assert.equal(active.stored.claude, "private-token");
	assert.deepEqual(io.calls.filter(([kind]) => kind === "sbx"), [
		[
			"sbx",
			"secret",
			"set-custom",
			"--host",
			"api.anthropic.com",
			"--env",
			"CLAUDE_CODE_OAUTH_TOKEN",
			"--placeholder",
			"sk-ant-oat01-fleet-placeholder",
			"--refresh",
			"1m",
			"--command",
			"/usr/bin/security find-generic-password -s fleet-claude-active -a claude -w",
		],
	]);
});

test("the account in use is the last one switched to", () => {
	const io = fakeIo();
	const stores = { accounts: keychain({ work: "work-token", private: "private-token" }), active: keychain() };

	const before = activeAccount(io);
	useAccount("work", stores, io);
	useAccount("private", stores, io);

	assert.equal(before, undefined);
	assert.equal(activeAccount(io), "private");
});

test("an account without a stored token is refused and nothing switches", () => {
	const io = fakeIo();
	const active = keychain({ claude: "work-token" });

	assert.throws(
		() => useAccount("private", { accounts: keychain({ work: "work-token" }), active }, io),
		/no token stored for private: fleet account set private/,
	);
	assert.equal(active.stored.claude, "work-token");
	assert.deepEqual(io.calls, []);
});
