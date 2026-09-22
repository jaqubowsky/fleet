import fleetMonitor from "../extensions/fleet-monitor.ts";
import guard from "../extensions/guard.ts";
import { HARNESSES } from "../src/harness.ts";

export default function (omp: any) {
	fleetMonitor(HARNESSES.omp)(omp);
	guard(HARNESSES.omp)(omp);
}
