import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseProfiles, profileFor } from "./profile.ts";

export const PRIVATE_REPO = "alice/private-app";

export const PRIVATE_PROFILE = {
	host: { sign: "none", push: "auto", pr: "auto", merge: "auto", down: "human", linear: "write", linearServer: "linear-private" },
	container: { push: "auto", pr: "auto", linear: "read", linearServer: "linear-private-readonly", token: "keychain:private-app" },
	resources: { memory: "4g", cpus: "4" },
};

export const REPO_PROFILES = readFileSync(join(import.meta.dirname, "../../host/repos.json"), "utf8");

const OWNERS = {
	"acme/*": {
		host: { sign: "none", push: "human", pr: "none", merge: "none", down: "human", linear: "none" },
		container: { push: "none", pr: "auto", linear: "read", linearServer: "linear-acme-readonly", token: "keychain:acme" },
		resources: { memory: "12g", cpus: "4" },
	},
};

export const SAMPLE_PROFILES = JSON.stringify({ ...OWNERS, ...JSON.parse(REPO_PROFILES) });

export const WITH_PRIVATE = JSON.stringify({ ...JSON.parse(SAMPLE_PROFILES), [PRIVATE_REPO]: PRIVATE_PROFILE });

export const today = () => profileFor(parseProfiles(REPO_PROFILES), "").host;
