import assert from "node:assert/strict";
import test from "node:test";
import { marked } from "marked";
import { tree, type Node } from "../../extensions/pi-remote/markdown.js";

const parse = (source: string) => tree(marked.lexer(source));

const attributesOf = (nodes: Node[]): [string, string][] =>
	nodes.flatMap((node) =>
		"tag" in node
			? [...Object.entries(node.attributes), ...attributesOf(node.children)]
			: [],
	);

test("paragraph keeps emphasis and a safe link", () => {
	const source = "Run **fast** and see [docs](https://pi.dev).";

	const [paragraph] = parse(source);

	assert.deepEqual(paragraph, {
		tag: "p",
		attributes: {},
		children: [
			{ text: "Run " },
			{ tag: "strong", attributes: {}, children: [{ text: "fast" }] },
			{ text: " and see " },
			{
				tag: "a",
				attributes: {
					href: "https://pi.dev",
					rel: "noopener noreferrer",
					target: "_blank",
				},
				children: [{ text: "docs" }],
			},
			{ text: "." },
		],
	});
});

test("hostile markdown becomes text, never an attribute that runs", () => {
	const source = [
		"<script>alert(1)</script>",
		"",
		'<img src=x onerror="alert(2)">',
		"",
		"[tap me](javascript:alert(3))",
	].join("\n");

	const nodes = parse(source);
	const attributes = attributesOf(nodes);

	assert.deepEqual(
		attributes.filter(([name]) => name.startsWith("on")),
		[],
		"no event-handler attribute survives",
	);
	assert.deepEqual(
		attributes.filter(([name]) => name === "href" || name === "src"),
		[],
		"no url attribute survives a hostile source",
	);
	assert.deepEqual(nodes[0], { text: "<script>alert(1)</script>" });
	assert.deepEqual(nodes[1], { text: '<img src=x onerror="alert(2)">' });
	assert.deepEqual(nodes[2], {
		tag: "p",
		attributes: {},
		children: [{ text: "tap me" }],
	});
});

test("headings lists blockquotes and inline code keep their shape", () => {
	const source = [
		"## Plan",
		"",
		"- run `npm test`",
		"- ship it",
		"",
		"> keep the gate green",
	].join("\n");

	const [heading, list, quote] = parse(source);

	assert.deepEqual(heading, {
		tag: "h2",
		attributes: {},
		children: [{ text: "Plan" }],
	});
	assert.deepEqual(list, {
		tag: "ul",
		attributes: {},
		children: [
			{
				tag: "li",
				attributes: {},
				children: [
					{ text: "run " },
					{ tag: "code", attributes: {}, children: [{ text: "npm test" }] },
				],
			},
			{ tag: "li", attributes: {}, children: [{ text: "ship it" }] },
		],
	});
	assert.deepEqual(quote, {
		tag: "blockquote",
		attributes: {},
		children: [
			{
				tag: "p",
				attributes: {},
				children: [{ text: "keep the gate green" }],
			},
		],
	});
});

test("a table keeps its header row and column alignment", () => {
	const source = [
		"| file | lines |",
		"| :--- | ----: |",
		"| a.ts | 12 |",
	].join("\n");

	const [table] = parse(source);

	assert.deepEqual(table, {
		tag: "table",
		attributes: {},
		children: [
			{
				tag: "thead",
				attributes: {},
				children: [
					{
						tag: "tr",
						attributes: {},
						children: [
							{
								tag: "th",
								attributes: { "data-align": "left" },
								children: [{ text: "file" }],
							},
							{
								tag: "th",
								attributes: { "data-align": "right" },
								children: [{ text: "lines" }],
							},
						],
					},
				],
			},
			{
				tag: "tbody",
				attributes: {},
				children: [
					{
						tag: "tr",
						attributes: {},
						children: [
							{
								tag: "td",
								attributes: { "data-align": "left" },
								children: [{ text: "a.ts" }],
							},
							{
								tag: "td",
								attributes: { "data-align": "right" },
								children: [{ text: "12" }],
							},
						],
					},
				],
			},
		],
	});
});

test("a fenced block carries its code and language untouched", () => {
	const source = ["```ts", "const x = 1 < 2 && 3 > 2;", "```"].join("\n");

	const [block] = parse(source);

	assert.deepEqual(block, {
		tag: "pre",
		attributes: {},
		children: [
			{
				tag: "code",
				attributes: { "data-language": "ts" },
				children: [{ text: "const x = 1 < 2 && 3 > 2;" }],
			},
		],
	});
});

test("emphasis strikethrough breaks escapes and entities read as written", () => {
	const source = "*soft* ~~gone~~ a\\*b AT&T &amp; co";

	const [paragraph] = parse(source);

	assert.deepEqual(paragraph, {
		tag: "p",
		attributes: {},
		children: [
			{ tag: "em", attributes: {}, children: [{ text: "soft" }] },
			{ text: " " },
			{ tag: "del", attributes: {}, children: [{ text: "gone" }] },
			{ text: " a" },
			{ text: "*" },
			{ text: "b AT&T & co" },
		],
	});
});

test("an image reaches the phone as its alt text", () => {
	const source = "![a diagram](https://pi.dev/x.png)";

	const [paragraph] = parse(source);

	assert.deepEqual(paragraph, {
		tag: "p",
		attributes: {},
		children: [{ text: "a diagram" }],
	});
});

test("an entity that names no character stays on the page as text", () => {
	const source = "budget &#9999999; and &#xFFFFFFF; and &nope; survive";

	const [paragraph] = parse(source);

	assert.deepEqual(paragraph, {
		tag: "p",
		attributes: {},
		children: [
			{ text: "budget &#9999999; and &#xFFFFFFF; and &nope; survive" },
		],
	});
});
