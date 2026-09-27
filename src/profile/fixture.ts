import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseProfiles, profileFor } from "./profile.ts";

export const PRIVATE_REPO = "alice/private-app";

export const PRIVATE_PROFILE = {
	host: { sign: "none", push: "auto", pr: "auto", merge: "auto", down: "human", linear: "write", linearServer: "linear-private" },
	container: { push: "auto", pr: "auto", linear: "read", linearServer: "linear-private-readonly", token: "op://Dev/GitHub PAT private-app/credential" },
	resources: { memory: "4g", cpus: "4" },
};

export const REAL_PROFILES = readFileSync(join(import.meta.dirname, "../../host/repos.json"), "utf8");

export const WITH_PRIVATE = JSON.stringify({ ...JSON.parse(REAL_PROFILES), [PRIVATE_REPO]: PRIVATE_PROFILE });

export const today = () => profileFor(parseProfiles(REAL_PROFILES), "").host;
