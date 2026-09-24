export const CREDENTIAL = /^[a-f0-9]{64}$/;

export function credential(location, history, storage) {
	const fragment = location.hash.slice(1);
	if (CREDENTIAL.test(fragment)) storage.setItem("pi-remote-credential", fragment);
	if (location.hash) history.replaceState(null, "", location.pathname);
	return CREDENTIAL.test(fragment)
		? fragment
		: (storage.getItem("pi-remote-credential") ?? "");
}

const REFUSED = ["Link expired", "Too many phones", "Session ended"];

export function deliberate(error, aborted) {
	return aborted === true && error?.name === "AbortError";
}

export function terminal(message) {
	return REFUSED.some((refusal) => message.startsWith(refusal));
}
