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
	const row = (label, text) => {
		const article = document.createElement("article");
		const role = label.split(" · ")[0];
		article.dataset.role = role;
		const heading = document.createElement("strong");
		heading.textContent = label;
		article.append(heading, prose(role, text));
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
function prose(role, text) {
	if (role !== "user" && role !== "assistant") {
		const output = document.createElement("pre");
		output.className = "output";
		output.textContent = text;
		return output;
	}
	const body = document.createElement("div");
	body.className = "markdown";
	body.append(...tree(marked.lexer(text)).map(build));
	return body;
}
function build(node) {
	if ("text" in node) return document.createTextNode(node.text);
	if (node.tag === "pre") return codeBlock(node);
	const element = document.createElement(node.tag);
	for (const [name, value] of Object.entries(node.attributes))
		element.setAttribute(name, value);
	element.append(...node.children.map(build));
	return element;
}
function codeBlock(node) {
	const [{ attributes, children }] = node.children;
	const source = children[0]?.text ?? "";
	const language = attributes["data-language"];
	const figure = document.createElement("figure");
	figure.className = "code";
	const caption = document.createElement("figcaption");
	const name = document.createElement("span");
	name.textContent = language ?? "text";
	const copy = document.createElement("button");
	copy.type = "button";
	copy.textContent = "Copy";
	copy.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(source);
			copy.textContent = "Copied";
		} catch {
			copy.textContent = "Copy failed";
		}
	});
	caption.append(name, copy);
	const pre = document.createElement("pre");
	const code = document.createElement("code");
	if (language && hljs.getLanguage(language))
		code.innerHTML = hljs.highlight(source, { language }).value;
	else code.textContent = source;
	pre.append(code);
	figure.append(caption, pre);
	return figure;
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
