import type { AgentName } from "../harness.ts";

const FLEET_HOME = ".fleet";

export const FLEET = {
	config: `${FLEET_HOME}/config`,
	tasks: `${FLEET_HOME}/tasks`,
	cache: `${FLEET_HOME}/cache`,
	backups: `${FLEET_HOME}/backups`,
};

export const agentCache = (agent: AgentName) => `${FLEET.cache}/${agent}`;
