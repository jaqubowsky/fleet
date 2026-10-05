export type FleetWatching = string;

declare module "claude-code" {
	interface PluginState {
		fleet: { watching: FleetWatching };
	}
}
