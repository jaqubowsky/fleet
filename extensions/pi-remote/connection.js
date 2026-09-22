export function deliberate(error, aborted) {
	return aborted === true && error?.name === "AbortError";
}
