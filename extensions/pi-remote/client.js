import { deliberate, terminal } from "/connection.js";
import hljs from "/vendor/highlight.js";
import { marked } from "/vendor/marked.js";
import { tree } from "/markdown.js";

const fragment = location.hash.slice(1);
const token = /^[a-f0-9]{64}$/.test(fragment)
	? fragment
	: sessionStorage.getItem("pi-remote-credential") ?? "";
if (/^[a-f0-9]{64}$/.test(fragment))
	sessionStorage.setItem("pi-remote-credential", fragment);
if (location.hash) history.replaceState(null, "", location.pathname);
const headers = { Authorization: `Bearer ${token}` };
const $ = (id) => document.getElementById(id);
let snapshot;
let connected = false;
let sending = false;
let controller;
let delivery = "followUp";
let previousStatus;
let resyncing = false;
const submitted = [];
const acknowledged = new Set();

function controls() {
	const control = snapshot?.control !== false;
	document.body.dataset.connected = String(connected);
	if (!connected) {
		$("status").textContent = "offline";
		$("status").dataset.state = "offline";
	}
	$("send").disabled = !connected || sending || !snapshot?.session;
	$("abort").disabled = !connected || sending || !snapshot?.session;
	$("command").hidden = !control;
	$("view-note").hidden = control;
	dock();
}
function dock() {
	const footer = document.querySelector(".dock");
	document.documentElement.style.setProperty(
		"--dock",
		`${footer.offsetHeight}px`,
	);
}
function banner(message, tone) {
	const node = $("banner");
	node.hidden = !message;
	node.textContent = message ?? "";
	if (tone) node.dataset.tone = tone;
	else delete node.dataset.tone;
}
const atBottom = () =>
	$("thread").getBoundingClientRect().bottom <=
		document.querySelector(".dock").getBoundingClientRect().top;

function facts(header) {
	if (!header) return [];
	const rows = [
		["model", header.model],
		["context", header.percent === undefined ? "" : `${header.percent}%`],
		["cost", header.cost === undefined ? "" : `$${header.cost.toFixed(2)}`],
		["cwd", header.cwd],
		["queued", header.queued ? "yes" : ""],
	];
	return rows
		.filter(([, value]) => value)
		.map(([label, value]) => {
			const item = document.createElement("li");
			const name = document.createElement("span");
			name.textContent = label;
			const body = document.createElement("strong");
			body.textContent = value;
			item.append(name, body);
			return item;
		});
}
const SETTLED = ["idle", "waiting for terminal"];

function announce(status) {
	navigator.vibrate?.([120, 60, 120]);
	if (window.Notification?.permission !== "granted") return;
	new Notification("Pi remote", {
		body: status === "idle" ? "The turn is done." : "Pi is waiting on the terminal.",
		tag: "pi-remote-status",
	});
}
function notifications() {
	const ask = $("notify");
	ask.hidden = window.Notification?.permission !== "default";
	ask.addEventListener("click", async () => {
		await Notification.requestPermission();
		ask.hidden = Notification.permission !== "default";
	});
}
function matchingMessage(transcript, item) {
	return transcript.find((message) =>
		message.role === "user" && message.seq > item.after &&
		!acknowledged.has(message.seq) && message.blocks.some((block) =>
			block.kind === "text" && block.text === item.text,
		),
	);
}
function render(next, follow = !snapshot || atBottom()) {
	if (snapshot?.generation !== next.generation) {
		submitted.length = 0;
		acknowledged.clear();
	}
	for (let index = 0; index < submitted.length;) {
		const match = matchingMessage(next.transcript, submitted[index]);
		if (match) {
			acknowledged.add(match.seq);
			submitted.splice(index, 1);
		} else index++;
	}
	const visible = new Set(next.transcript.map((item) => item.seq));
	for (const seq of acknowledged)
		if (!visible.has(seq)) acknowledged.delete(seq);
	const previous = previousStatus;
	if (previous === "running" && SETTLED.includes(next.status))
		announce(next.status);
	previousStatus = next.status;
	snapshot = next;
	document.body.dataset.working = String(next.status === "running");
	$("session-name").textContent = next.session?.name ?? "Session changing";
	$("status").textContent = next.status;
	$("status").dataset.state = next.status;
	if (next.status !== previous) $("live").textContent = `Pi is ${next.status}.`;
	banner(
		next.session
			? undefined
			: "Your terminal is reconnecting. The transcript below is the last thing Pi sent.",
	);
	const detail = facts(next.header);
	$("facts").replaceChildren(...detail);
	$("detail-toggle").hidden = detail.length === 0;
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
		...(next.assistant ? [turn(next.assistant, true)] : []),
		...next.tools.filter((block) => !settled.has(block.id)).map(tool),
		...submitted.map((item) => pendingMessage(item.text)),
	);
	controls();
	if (follow) scrollToLatest();
	else $("jump").hidden = false;
}
function scrollToLatest() {
	window.scrollTo({ top: document.body.scrollHeight });
	$("jump").hidden = true;
}
function pendingMessage(text) {
	const article = document.createElement("article");
	article.className = "turn submitted";
	const label = document.createElement("p");
	label.className = "turn-label";
	label.textContent = "You · submitted, awaiting transcript";
	const body = document.createElement("p");
	body.textContent = text;
	article.append(label, body);
	return article;
}
function turn(message, streaming) {
	const article = document.createElement("article");
	article.className = "turn";
	article.dataset.role = message.role;
	if (streaming) article.dataset.streaming = "true";
	const heading = document.createElement("p");
	heading.className = "turn-label";
	const who = document.createElement("span");
	who.textContent = message.role === "user" ? "You" : "Pi";
	heading.append(who);
	if (message.at !== undefined) {
		const when = document.createElement("time");
		when.dateTime = new Date(message.at).toISOString();
		when.textContent = new Date(message.at).toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});
		heading.append(when);
	}
	article.append(
		heading,
		...message.blocks.map((block) =>
			block.kind === "text" ? markdown(block.text) : tool(block),
		),
	);
	return article;
}
const PATHS = {
	terminal: "M4 6l5 5-5 5M12 16h8",
	file: "M6 3h7l5 5v13H6zM13 3v5h5",
	pencil: "M4 20h4L20 8l-4-4L4 16z",
	search: "M11 4a7 7 0 107 7 7 7 0 00-7-7zM20 20l-4-4",
	list: "M4 6h16M4 12h16M4 18h10",
	download: "M12 4v11M7 11l5 5 5-5M5 20h14",
	agent: "M12 3a9 9 0 109 9 9 9 0 00-9-9zM12 8v8M8 12h8",
	dot: "M12 8a4 4 0 104 4 4 4 0 00-4-4z",
	check: "M5 13l4 4L19 7",
	alert: "M12 5v8M12 17v.5",
	spinner: "M12 4a8 8 0 018 8",
};
const ICONS = {
	bash: "terminal",
	read: "file",
	write: "pencil",
	edit: "pencil",
	ls: "list",
	grep: "search",
	find: "search",
	web_search: "search",
	fetch_content: "download",
	source_check: "download",
	get_search_content: "download",
	subagent: "agent",
};
const STATES = { running: "spinner", done: "check", error: "alert" };

function icon(name) {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute("d", PATHS[name] ?? PATHS.dot);
	svg.append(path);
	return svg;
}
function tool(block) {
	const card = document.createElement("details");
	card.className = "tool";
	card.dataset.state = block.state;
	const head = document.createElement("summary");
	const name = document.createElement("span");
	name.className = "tool-name";
	name.textContent = block.name;
	const summary = document.createElement("span");
	summary.className = "tool-summary";
	summary.textContent = block.summary;
	const state = document.createElement("span");
	state.className = "tool-state";
	state.append(icon(STATES[block.state]));
	head.append(icon(ICONS[block.name]), name, summary, state);
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
	copy.className = "quiet";
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
	code.textContent = source;
	if (language && hljs.getLanguage(language)) {
		code.className = `language-${language}`;
		hljs.highlightElement(code);
	}
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
				: response.status === 429
					? "Too many phones are watching this link. Close one and open it again."
					: `Request rejected (${response.status}). Resync before retrying.`,
		);
	return response;
}
async function connect() {
	if (!/^[a-f0-9]{64}$/.test(token)) {
		banner("Open the private URL that /remote link shows.", "danger");
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
			if (reader) await reader.cancel().catch(() => {});
			previousStatus = undefined;
			if (deliberate(error, resyncing)) {
				resyncing = false;
				continue;
			}
			connected = false;
			controls();
			banner(error.message, "danger");
			if (terminal(error.message)) return;
			await new Promise((resolve) => setTimeout(resolve, 1500));
		}
	}
}
async function send(action) {
	if (!connected || sending || !snapshot?.session || snapshot.control === false)
		return;
	sending = true;
	controls();
	const text = $("text").value;
	const generation = snapshot.generation;
	const after = snapshot.userSequence;
	try {
		const accepted = await (await request("/command", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				generation,
				action,
				...(action === "abort" ? {} : { text }),
			}),
		})).json();
		const follow = atBottom();
		if (action === "abort") submitted.length = 0;
		else {
			if (snapshot.generation === generation) {
				const item = { text: accepted.display, after };
				const match = matchingMessage(snapshot.transcript, item);
				if (match) acknowledged.add(match.seq);
				else submitted.push(item);
			}
			if ($("text").value === text) $("text").value = "";
		}
		$("feedback").textContent = "Accepted";
		render(snapshot, follow);
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
	void send(delivery);
});
for (const button of document.querySelectorAll(".delivery button"))
	button.addEventListener("click", () => {
		delivery = button.dataset.mode;
		for (const other of document.querySelectorAll(".delivery button"))
			other.setAttribute("aria-pressed", String(other === button));
	});
$("detail-toggle").addEventListener("click", () => {
	const open = $("facts").hidden;
	$("facts").hidden = !open;
	$("detail-toggle").setAttribute("aria-expanded", String(open));
	dock();
});
$("jump").addEventListener("click", scrollToLatest);
window.addEventListener("scroll", () => {
	if (atBottom()) $("jump").hidden = true;
});
$("abort").addEventListener("click", () => {
	void send("abort");
});
document.addEventListener("visibilitychange", () => {
	if (document.hidden || !controller) return;
	resyncing = true;
	controller.abort();
});
$("text").addEventListener("input", () => {
	const field = $("text");
	field.style.height = "auto";
	field.style.height = `${field.scrollHeight}px`;
	dock();
});
window.addEventListener("resize", dock);
notifications();
dock();
void connect();
