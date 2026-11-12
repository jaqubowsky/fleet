import { CLI } from "../harness.ts";
import { FLEET_HOME } from "./home.ts";
import type { Io } from "./io.ts";
import { type Keychain, keychainFor, keychainRead } from "./tokens.ts";

const ACTIVE_SERVICE = "fleet-claude-active";
const ACTIVE_NAME = "claude";
const PLACEHOLDER = "sk-ant-oat01-fleet-placeholder";

type Stores = { accounts: Keychain; active: Keychain };

export const accountStores: Stores = { accounts: keychainFor("fleet-claude"), active: keychainFor(ACTIVE_SERVICE) };

const accountFile = (io: Io) => `${io.home}/${FLEET_HOME}/claude-account`;

export function activeAccount(io: Io): string | undefined {
	return io.read(accountFile(io))?.trim() || undefined;
}

export function useAccount(name: string, stores: Stores, io: Io): string {
	const token = stores.accounts.read(name);
	if (!token) throw new Error(`no token stored for ${name}: ${CLI} account set ${name}`);
	stores.active.write(ACTIVE_NAME, token);
	io.sbx(
		[
			"secret",
			"set-custom",
			"--host",
			"api.anthropic.com",
			"--env",
			"CLAUDE_CODE_OAUTH_TOKEN",
			"--placeholder",
			PLACEHOLDER,
			"--refresh",
			"1m",
			"--command",
			`/usr/bin/${keychainRead(ACTIVE_NAME, ACTIVE_SERVICE)}`,
		],
		{ quiet: true },
	);
	io.write(accountFile(io), `${name}\n`);
	return `containers use the Claude account ${name} within a minute; a sandbox made before the first switch needs a new up`;
}
