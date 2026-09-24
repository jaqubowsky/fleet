import { credential, CREDENTIAL, terminal } from "./connection.js";

const token = credential(location, history, localStorage);
const $ = (id) => document.getElementById(id);

function banner(message) {
	$("banner").hidden = !message;
	$("banner").textContent = message ?? "";
	$("banner").dataset.tone = "danger";
}
function row({ id, session, status, header }) {
	const item = document.createElement("li");
	const link = document.createElement("a");
	link.className = "session";
	link.href = `s/${id}/`;
	const name = document.createElement("strong");
	name.textContent = session?.name ?? "Session changing";
	const chip = document.createElement("span");
	chip.className = "chip";
	chip.dataset.state = status;
	chip.textContent = status;
	const detail = document.createElement("span");
	detail.className = "session-detail";
	detail.textContent = [header?.cwd, header?.model].filter(Boolean).join(" · ");
	link.append(name, chip, detail);
	item.append(link);
	return item;
}
async function refresh() {
	try {
		const response = await fetch("sessions", {
			headers: { Authorization: `Bearer ${token}` },
			cache: "no-store",
		}).catch(() => {
			throw new Error("Pi is unreachable. Retrying.");
		});
		if (!response.ok)
			throw new Error(
				response.status === 401
					? "Link expired. Scan /remote link again."
					: `Sessions unavailable (${response.status}). Retrying.`,
			);
		const { sessions } = await response.json();
		$("sessions").replaceChildren(...sessions.map(row));
		$("empty").hidden = sessions.length > 0;
		banner();
		return true;
	} catch (error) {
		banner(error.message);
		return !terminal(error.message);
	}
}
async function poll() {
	if (!document.hidden && !(await refresh())) return;
	setTimeout(poll, 3000);
}
if (CREDENTIAL.test(token)) void poll();
else banner("Open the private URL that /remote link shows.");
