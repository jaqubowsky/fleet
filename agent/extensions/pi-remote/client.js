const token = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
const headers = { Authorization: `Bearer ${token}` };
const $ = (id) => document.getElementById(id);
let snapshot;
let connected = false;
let sending = false;
let controller;

function controls() {
	document.body.dataset.connected = String(connected);
	$("connection").textContent = connected ? "Live" : "Offline";
	$("send").disabled = !connected || sending || !snapshot?.session;
	$("abort").disabled = !connected || sending || !snapshot?.session;
}
function render(next) {
	snapshot = next;
	$("session-name").textContent = next.session?.name ?? "Session changing";
	$("session-id").textContent =
		next.session?.id ?? "Reconnecting to your terminal";
	$("status").textContent = next.status;
	$("status").dataset.state = next.status;
	$("empty").hidden =
		next.transcript.length > 0 ||
		Boolean(next.assistant) ||
		next.tools.length > 0;
	const row = (label, text) => {
		const article = document.createElement("article");
		article.dataset.role = label.split(" · ")[0];
		const heading = document.createElement("strong");
		heading.textContent = label;
		const body = document.createElement("pre");
		body.textContent = text;
		article.append(heading, body);
		return article;
	};
	$("transcript").replaceChildren(
		...next.transcript.map((item) => row(item.role, item.text)),
	);
	$("activity").replaceChildren(
		...(next.assistant
			? [row("assistant · streaming", next.assistant.text)]
			: []),
		...next.tools.map((tool) => row(`${tool.name} · ${tool.state}`, tool.text)),
	);
	controls();
}
async function request(path, options = {}) {
	const response = await fetch(path, {
		...options,
		headers: { ...headers, ...options.headers },
		cache: "no-store",
		signal: controller.signal,
	});
	if (!response.ok)
		throw new Error(
			response.status === 401
				? "Link expired. Scan /remote link again."
				: `Request rejected (${response.status}). Resync before retrying.`,
		);
	return response;
}
async function connect() {
	if (!/^[a-f0-9]{64}$/.test(token)) {
		$("status").textContent = "Open the private URL from /remote link.";
		return;
	}
	for (;;) {
		controller = new AbortController();
		let reader;
		try {
			render(await (await request("/bootstrap")).json());
			reader = (await request("/events")).body.getReader();
			const decoder = new TextDecoder();
			let pending = "";
			for (;;) {
				const part = await reader.read();
				if (part.done) throw new Error("Disconnected. Reconnecting...");
				pending += decoder.decode(part.value, { stream: true });
				if (pending.length > 4 * 1024 * 1024)
					throw new Error("Stream limit exceeded");
				let end;
				while ((end = pending.indexOf("\n\n")) >= 0) {
					const frame = pending.slice(0, end);
					pending = pending.slice(end + 2);
					const data = frame
						.split("\n")
						.find((line) => line.startsWith("data: "));
					if (data) {
						connected = true;
						render(JSON.parse(data.slice(6)));
					}
				}
			}
		} catch (error) {
			connected = false;
			controls();
			$("status").textContent = error.message;
			if (reader) await reader.cancel().catch(() => {});
			if (error.message.startsWith("Link expired")) return;
			await new Promise((resolve) => setTimeout(resolve, 1500));
		}
	}
}
async function send(action) {
	if (!connected || sending || !snapshot?.session) return;
	sending = true;
	controls();
	const text = $("text").value;
	try {
		await request("/command", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				generation: snapshot.generation,
				action,
				...(action === "abort" ? {} : { text }),
			}),
		});
		if (action !== "abort" && $("text").value === text) $("text").value = "";
		$("feedback").textContent = "Accepted";
	} catch (error) {
		$("feedback").textContent = `${error.message} Not retried automatically.`;
		controller.abort();
	} finally {
		sending = false;
		controls();
	}
}
$("command").addEventListener("submit", (event) => {
	event.preventDefault();
	void send("followUp");
});
$("abort").addEventListener("click", () => {
	void send("abort");
});
document.addEventListener("visibilitychange", () => {
	if (!document.hidden) controller?.abort();
});
void connect();
