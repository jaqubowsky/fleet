import assert from "node:assert/strict";
import { test } from "node:test";
import { accountOf, enrol, readLedger, release, useAccount } from "./account.ts";
import { fakeIo } from "./fake-io.ts";

const LEDGER = "/home/me/.fleet/claude-accounts.json";

function keychain(stored: Record<string, string> = {}) {
	return {
		has: (name: string) => name in stored,
		read: (name: string) => stored[name],
		write: (name: string, value: string) => {
			stored[name] = value;
		},
	};
}

const accounts = keychain({ work: "work-token", private: "private-token" });

function keyOf(env: string[]): string {
	const entry = env.find((line) => line.startsWith("ANTHROPIC_AUTH_TOKEN="));
	return entry?.slice("ANTHROPIC_AUTH_TOKEN=".length) ?? "";
}

test("a sandbox enrolled after a switch reaches the forwarder with a key of its own that bills the account in use", () => {
	const io = fakeIo();
	useAccount("work", [], accounts, io);

	const env = enrol("claude-web-1", io);

	assert.ok(env.includes("ANTHROPIC_BASE_URL=http://host.docker.internal:18080"));
	assert.match(keyOf(env), /^fleet-[0-9a-f]{48}$/);
	assert.equal(accountOf(keyOf(env), readLedger(io)), "work");
});

test("switching the account moves every sandbox without one of its own on its next request", () => {
	const io = fakeIo();
	useAccount("work", [], accounts, io);
	const key = keyOf(enrol("claude-web-1", io));

	useAccount("private", [], accounts, io);

	assert.equal(accountOf(key, readLedger(io)), "private");
});

test("an orchestrator started with FLEET_CLAUDE_ACCOUNT keeps its sandboxes on that account through a switch", () => {
	const io = fakeIo({ "env FLEET_CLAUDE_ACCOUNT": "private" });
	useAccount("work", [], accounts, io);
	const key = keyOf(enrol("claude-web-1", io));

	useAccount("work", [], accounts, io);

	assert.equal(accountOf(key, readLedger(io)), "private");
});

test("one sandbox can be moved to another account while the rest stay", () => {
	const io = fakeIo();
	useAccount("work", [], accounts, io);
	const moved = keyOf(enrol("claude-web-1", io));
	const kept = keyOf(enrol("claude-web-2", io));

	useAccount("private", ["claude-web-1"], accounts, io);

	assert.equal(accountOf(moved, readLedger(io)), "private");
	assert.equal(accountOf(kept, readLedger(io)), "work");
});

test("a key the ledger never issued, or one of a removed sandbox, opens no account", () => {
	const io = fakeIo();
	useAccount("work", [], accounts, io);
	const key = keyOf(enrol("claude-web-1", io));

	release("claude-web-1", io);

	assert.equal(accountOf(key, readLedger(io)), undefined);
	assert.equal(accountOf("fleet-guess", readLedger(io)), undefined);
});

test("enrolling with no account chosen anywhere is refused before anything is written", () => {
	const io = fakeIo();

	assert.throws(() => enrol("claude-web-1", io), /no Claude account: run fleet account use <name>/);
	assert.equal(io.files[LEDGER], undefined);
});

test("switching to an account with no stored token, or a sandbox the ledger does not know, changes nothing", () => {
	const io = fakeIo();
	useAccount("work", [], accounts, io);
	const before = io.files[LEDGER];

	assert.throws(() => useAccount("bogus", [], accounts, io), /no token stored for bogus: fleet account set bogus/);
	assert.throws(() => useAccount("private", ["claude-old"], accounts, io), /claude-old has no forwarder key/);
	assert.equal(io.files[LEDGER], before);
});

test("the ledger is written readable by its owner only", () => {
	const io = fakeIo();

	useAccount("work", [], accounts, io);

	assert.equal(io.modes[LEDGER], 0o600);
});
