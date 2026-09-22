import hljs from "/vendor/highlight.js";
import { marked } from "/vendor/marked.js";
import { tree } from "/markdown.js";

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
	$("transcript").replaceChildren(...next.transcript.map((item) => turn(item)));
	const settled = new Set(
		next.transcript.flatMap((item) =>
			item.blocks.filter((block) => block.kind === "tool").map((block) => block.id),
		),
	);
	$("activity").replaceChildren(
		...(next.assistant ? [turn(next.assistant, "streaming")] : []),
		...next.tools.filter((block) => !settled.has(block.id)).map(tool),
	);
	controls();
}
function turn(message, note) {
	const article = document.createElement("article");
	article.dataset.role = message.role;
	const heading = document.createElement("strong");
	heading.textContent = note ? `${message.role} · ${note}` : message.role;
	article.append(
		heading,
		...message.blocks.map((block) =>
			block.kind === "text" ? markdown(block.text) : tool(block),
		),
	);
	return article;
}
const ICONS = {
	bash: "$",
	read: "▤",
	write: "✎",
	edit: "✎",
	ls: "▤",
	grep: "⌕",
	find: "⌕",
	web_search: "⌕",
	fetch_content: "↓",
	source_check: "↓",
	get_search_content: "↓",
	subagent: "⊕",
};
const STATES = { running: "", done: "✓", error: "!" };

function tool(block) {
	const card = document.createElement("details");
	card.className = "tool";
	card.dataset.state = block.state;
	const head = document.createElement("summary");
	const icon = document.createElement("span");
	icon.className = "tool-icon";
	icon.textContent = ICONS[block.name] ?? "•";
	const name = document.createElement("strong");
	name.textContent = block.name;
	const summary = document.createElement("span");
	summary.className = "tool-summary";
	summary.textContent = block.summary;
	const state = document.createElement("span");
	state.className = "tool-state";
	state.textContent = STATES[block.state] ?? "";
	head.append(icon, name, summary, state);
	card.append(head);
	if (block.diff) card.append(diff(block.diff));
	if (block.result) card.append(output(block.result));
	if (!block.diff && !block.result) card.append(output("No output yet."));
	return card;
}
function diff(text) {
	const pre = document.createElement("pre");
	pre.className = "diff";
	for (const line of text.split("\n")) {
		const row = document.createElement("span");
		row.dataset.change =
			line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : "kept";
		row.textContent = `${line}\n`;
		pre.append(row);
	}
	return pre;
}
function output(text) {
	const pre = document.createElement("pre");
	pre.className = "output";
	pre.textContent = text;
	return pre;
}
function markdown(text) {
	const body = document.createElement("div");
	body.className = "markdown";
	body.append(...tree(marked.lexer(text)).map(build));
	return body;
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
