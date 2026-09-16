export type CodexArgs = { account: string; sentinel: string };

export function codexArgs(authJson: string | undefined): CodexArgs {
	const account = authJson ? (JSON.parse(authJson)?.["openai-codex"]?.accountId as string | undefined) : undefined;
	if (!account) return { account: "none", sentinel: "none" };
	const claim = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account } })).toString("base64");
	return { account, sentinel: `eyJhbGciOiJub25lIn0.${claim}.proxy-managed` };
}
