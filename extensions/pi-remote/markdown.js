const SAFE_LINK = /^https?:\/\//i;

const ENTITIES = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: "\u00a0",
};

const text = (value) => ({ text: value });
const prose = (value) => ({
	text: value.replace(/&(#\d{1,7}|#[xX][\da-fA-F]{1,6}|\w{2,8});/g, (whole, body) =>
		body.startsWith("#")
			? String.fromCodePoint(
					Number(body[1] === "x" || body[1] === "X" ? `0${body.slice(1)}` : body.slice(1)),
				)
			: (ENTITIES[body] ?? whole),
	),
});
const element = (tag, children, attributes = {}) => ({
	tag,
	attributes,
	children,
});

const inline = (tokens) => (tokens ?? []).flatMap(node);

const align = (value) => (value ? { "data-align": value } : {});
const language = (value) => {
	const name = (value ?? "").trim().split(/\s+/)[0];
	return /^[\w+#-]{1,24}$/.test(name) ? { "data-language": name } : {};
};

function node(token) {
	switch (token.type) {
		case "paragraph":
			return [element("p", inline(token.tokens))];
		case "heading":
			return [element(`h${Math.min(token.depth, 6)}`, inline(token.tokens))];
		case "list":
			return [
				element(
					token.ordered ? "ol" : "ul",
					token.items.map((item) => element("li", inline(item.tokens))),
					token.ordered && token.start !== 1
						? { start: String(token.start) }
						: {},
				),
			];
		case "blockquote":
			return [element("blockquote", inline(token.tokens))];
		case "codespan":
			return [element("code", [text(token.text)])];
		case "hr":
			return [element("hr", [])];
		case "table": {
			const cell = (tag) => (item, column) =>
				element(tag, inline(item.tokens), align(token.align[column]));
			return [
				element("table", [
					element("thead", [
						element("tr", token.header.map(cell("th"))),
					]),
					element(
						"tbody",
						token.rows.map((row) => element("tr", row.map(cell("td")))),
					),
				]),
			];
		}
		case "code":
			return [
				element("pre", [
					element("code", [text(token.text)], language(token.lang)),
				]),
			];
		case "strong":
			return [element("strong", inline(token.tokens))];
		case "link":
			return SAFE_LINK.test(token.href)
				? [
						element("a", inline(token.tokens), {
							href: token.href,
							rel: "noopener noreferrer",
							target: "_blank",
						}),
					]
				: inline(token.tokens);
		case "html":
			return [text(token.text)];
		case "text":
			return token.tokens ? inline(token.tokens) : [prose(token.text)];
		case "escape":
			return [prose(token.text)];
		case "em":
			return [element("em", inline(token.tokens))];
		case "del":
			return [element("del", inline(token.tokens))];
		case "br":
			return [element("br", [])];
		case "image":
			return [prose(token.text)];
		default:
			return [];
	}
}

export function tree(tokens) {
	return tokens.flatMap(node);
}
