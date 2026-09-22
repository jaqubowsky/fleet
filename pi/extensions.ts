import fleetMonitor from "../extensions/fleet-monitor.ts";
import guard from "../extensions/guard.ts";
import { HARNESSES } from "../src/harness.ts";

export default function (pi: any) {
	fleetMonitor(HARNESSES.pi)(pi);
	guard(HARNESSES.pi)(pi);
}
