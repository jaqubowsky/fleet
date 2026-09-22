export type Text = { text: string };
export type Element = {
	tag: string;
	attributes: Record<string, string>;
	children: Node[];
};
export type Node = Text | Element;
export declare function tree(tokens: unknown[]): Node[];
