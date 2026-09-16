import assert from "node:assert/strict";
import { test } from "node:test";
import { codexArgs } from "./codex.ts";

test("sentinel carries the ChatGPT account id", () => {
	const args = codexArgs(JSON.stringify({ "openai-codex": { accountId: "acct_1" } }));
	assert.equal(args.account, "acct_1");
	const [, claim] = args.sentinel.split(".");
	assert.deepEqual(JSON.parse(Buffer.from(claim, "base64").toString()), { "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" } });
});

test("no codex login yields placeholders instead of failing", () => {
	assert.deepEqual(codexArgs(undefined), { account: "none", sentinel: "none" });
	assert.deepEqual(codexArgs("{}"), { account: "none", sentinel: "none" });
});
