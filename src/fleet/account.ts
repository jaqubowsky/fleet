import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { CLI } from "../harness.ts";
import { FLEET_HOME } from "./home.ts";
import type { Io } from "./io.ts";
import { type Keychain, keychainFor } from "./tokens.ts";

export const FORWARDER_PORT = 18080;
const ACCOUNT_ENV = "FLEET_CLAUDE_ACCOUNT";
const SERVICE = "fleet-claude";

type Entry = { key: string; account?: string };
type Ledger = { default?: string; sandboxes: Record<string, Entry> };

export const claudeAccounts: Keychain = keychainFor(SERVICE);

export function readToken(account: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile("/usr/bin/security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"], (error, stdout) =>
			resolve(error ? undefined : stdout.trim() || undefined),
		);
	});
}

const ledgerPath = (io: Io) => `${io.home}/${FLEET_HOME}/claude-accounts.json`;

function isEntry(value: unknown): value is Entry {
	if (typeof value !== "object" || value === null || !("key" in value) || typeof value.key !== "string") return false;
	return !("account" in value) || typeof value.account === "string";
}

function isLedger(value: unknown): value is Ledger {
	if (typeof value !== "object" || value === null || !("sandboxes" in value)) return false;
	const { sandboxes } = value;
	if ("default" in value && typeof value.default !== "string") return false;
	return typeof sandboxes === "object" && sandboxes !== null && Object.values(sandboxes).every(isEntry);
}

export function readLedger(io: Io): Ledger {
	const text = io.read(ledgerPath(io));
	if (!text) return { sandboxes: {} };
	const value: unknown = JSON.parse(text);
	if (!isLedger(value)) throw new Error(`${ledgerPath(io)} is not a fleet account ledger`);
	return value;
}

function writeLedger(io: Io, ledger: Ledger): void {
	io.write(ledgerPath(io), `${JSON.stringify(ledger, null, 2)}\n`, 0o600);
}

export function accountOf(key: string, ledger: Ledger): string | undefined {
	const entry = Object.values(ledger.sandboxes).find((candidate) => candidate.key === key);
	return entry && (entry.account ?? ledger.default);
}

export function enrol(sandbox: string, io: Io): string[] {
	const ledger = readLedger(io);
	const account = io.env(ACCOUNT_ENV) || undefined;
	if (!account && !ledger.default)
		throw new Error(
			`${sandbox} has no Claude account: run ${CLI} account use <name> in your own terminal, or start this session with ${ACCOUNT_ENV}=<name>`,
		);
	const key = `fleet-${randomBytes(24).toString("hex")}`;
	ledger.sandboxes[sandbox] = account ? { key, account } : { key };
	writeLedger(io, ledger);
	return [`ANTHROPIC_BASE_URL=http://host.docker.internal:${FORWARDER_PORT}`, `ANTHROPIC_AUTH_TOKEN=${key}`];
}

export function release(sandbox: string, io: Io): void {
	const ledger = readLedger(io);
	if (!(sandbox in ledger.sandboxes)) return;
	delete ledger.sandboxes[sandbox];
	writeLedger(io, ledger);
}

export function useAccount(name: string, sandboxes: string[], accounts: Keychain, io: Io): string {
	if (!accounts.has(name)) throw new Error(`no token stored for ${name}: ${CLI} account set ${name}`);
	const ledger = readLedger(io);
	const unknown = sandboxes.find((sandbox) => !(sandbox in ledger.sandboxes));
	if (unknown) throw new Error(`${unknown} has no forwarder key: only a claude container brought up with accounts in place has one`);
	if (!sandboxes.length) ledger.default = name;
	for (const sandbox of sandboxes) ledger.sandboxes[sandbox].account = name;
	writeLedger(io, ledger);
	const who = sandboxes.length ? sandboxes.join(", ") : "every container without an account of its own";
	return `${who} bills ${name} from its next request`;
}

export function describeAccounts(io: Io): string[] {
	const ledger = readLedger(io);
	const fallback = ledger.default ?? "none";
	return [
		`default  ${fallback}`,
		...Object.entries(ledger.sandboxes).map(([sandbox, entry]) => `${sandbox}  ${entry.account ?? `default (${fallback})`}`),
	];
}
