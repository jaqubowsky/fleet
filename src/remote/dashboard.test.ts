import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { CREDENTIAL, credential as stored, terminal } from "../../extensions/pi-remote/connection.js";

const source = readFileSync(new URL("../../extensions/pi-remote/dashboard.js", import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
const credential = "a".repeat(64);

type Node = { tag: string; text: string; href?: string; children: Node[]; hidden: boolean; dataset: Record<string, string> };

function load(response: { status: number; body?: unknown }, requests: string[]) {
	const node = (tag: string): Node & Record<string, unknown> => {
		const created = {
			tag,
			children: [] as Node[],
			hidden: false,
			dataset: {},
			set textContent(value: string) { created.text = value; },
			get textContent() { return created.text; },
			text: "",
			className: "",
			append: (...nodes: Node[]) => created.children.push(...nodes),
			replaceChildren: (...nodes: Node[]) => { created.children = nodes; },
		};
		return created;
	};
	const elements = new Map<string, ReturnType<typeof node>>();
	const get = (id: string) => {
		if (!elements.has(id)) elements.set(id, node(id));
		return elements.get(id)!;
	};
	const location = { pathname: "/", hash: `#${credential}` };
	vm.runInContext(source, vm.createContext({
		location,
		history: { replaceState: () => { location.hash = ""; } },
		localStorage: { getItem: () => null, setItem() {} },
		document: { hidden: false, getElementById: get, createElement: node, addEventListener() {} },
		fetch: async (path: string, options: { headers: { Authorization: string } }) => {
			requests.push(`${path}:${options.headers.Authorization}`);
			return { ok: response.status === 200, status: response.status, json: async () => response.body };
		},
		setTimeout: () => {},
		CREDENTIAL,
		credential: stored,
		terminal,
	}));
	return { list: get("sessions"), empty: get("empty"), banner: get("banner") };
}

const text = (node: Node): string => node.text + node.children.map(text).join(" ");
const links = (node: Node): string[] => [...(node.href ? [node.href] : []), ...node.children.flatMap(links)];

test("the dashboard lists each session as a link to its page", async () => {
	const requests: string[] = [];
	const sessions = [
		{ id: "0123456789abcdef", session: { id: "one", name: "writer" }, status: "idle", header: { cwd: "/work/writer", model: "Opus 5" } },
		{ id: "fedcba9876543210", session: { id: "two", name: "reviewer" }, status: "running", header: { cwd: "/work/reviewer" } },
	];

	const page = load({ status: 200, body: { sessions } }, requests);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assert.deepEqual(requests, [`sessions:Bearer ${credential}`]);
	assert.deepEqual(links(page.list), ["s/0123456789abcdef/", "s/fedcba9876543210/"]);
	assert.match(text(page.list), /writer.*idle.*\/work\/writer · Opus 5/);
	assert.match(text(page.list), /reviewer.*running.*\/work\/reviewer/);
	assert.equal(page.empty.hidden, true);
});

test("an expired link says so on the dashboard", async () => {
	const page = load({ status: 401 }, []);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assert.equal(page.banner.text, "Link expired. Scan /remote link again.");
});
