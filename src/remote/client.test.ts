import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../extensions/pi-remote/client.js", import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
const credential = "a".repeat(64);

function load(browser: { hash: string; storage: Map<string, string> }, requests: string[]) {
	class Element {
		dataset: Record<string, string> = {};
		style = { setProperty() {} };
		textContent = "";
		hidden = false;
		disabled = false;
		offsetHeight = 128;
		addEventListener() {}
		replaceChildren() {}
		append() {}
		setAttribute() {}
	}
	const elements = new Map<string, Element>();
	const get = (id: string) => {
		if (!elements.has(id)) elements.set(id, new Element());
		return elements.get(id)!;
	};
	const document = {
		body: get("body"),
		documentElement: get("html"),
		getElementById: get,
		querySelector: () => get("dock"),
		querySelectorAll: () => [],
		createElement: () => new Element(),
		createElementNS: () => new Element(),
		addEventListener() {},
	};
	const location = { pathname: "/", hash: browser.hash };
	const snapshot = { version: 2, generation: 1, control: true, session: { id: "one", name: "one" }, status: "idle", header: {}, transcript: [], assistant: null, tools: [] };
	const context = vm.createContext({
		location,
		history: { replaceState: (_state: unknown, _unused: string, path: string) => {
			assert.equal(path, "/");
			location.hash = "";
		} },
		localStorage: { getItem: (key: string) => browser.storage.get(key) ?? null, setItem: (key: string, value: string) => browser.storage.set(key, value) },
		document,
		window: { innerHeight: 800, scrollY: 0, scrollTo() {}, addEventListener() {} },
		navigator: {},
		AbortController,
		fetch: async (path: string, options: { headers: { Authorization: string } }) => {
			requests.push(`${path}:${options.headers.Authorization}`);
			if (path === "/bootstrap") return { ok: true, json: async () => snapshot };
			return { ok: true, body: { getReader: () => ({ read: () => new Promise(() => {}) }) } };
		},
		TextDecoder,
		setTimeout,
		marked: {},
		hljs: {},
		tree: () => [],
		deliberate: () => false,
		terminal: () => false,
	});
	vm.runInContext(source, context);
	return { location, banner: get("banner") };
}

test("a link opened once keeps working on later visits without appearing in a URL", async () => {
	const browser = { hash: `#${credential}`, storage: new Map<string, string>() };
	const requests: string[] = [];
	const first = load(browser, requests);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(first.location.hash, "");
	browser.hash = first.location.hash;
	const later = load(browser, requests);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assert.equal(later.banner.textContent, "");
	assert.equal(requests.filter((request) => request === `/bootstrap:Bearer ${credential}`).length, 2);
	assert.equal(requests.some((request) => request.startsWith("/events:Bearer ")), true);
	assert.equal(requests.some((request) => request.split(":")[0].includes(credential)), false);
	const stranger = load({ hash: "", storage: new Map() }, requests);
	assert.equal(stranger.banner.textContent, "Open the private URL that /remote link shows.");
	assert.equal(requests.filter((request) => request.startsWith("/bootstrap:")).length, 2);
});
