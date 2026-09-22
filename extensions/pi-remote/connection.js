const REFUSED = ["Link expired", "Too many phones"];

export function deliberate(error, aborted) {
	return aborted === true && error?.name === "AbortError";
}

export function terminal(message) {
	return REFUSED.some((refusal) => message.startsWith(refusal));
}
