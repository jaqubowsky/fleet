import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { test } from "node:test";
import { forwarder } from "./forwarder.ts";

type Seen = { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string };

async function listen(server: http.Server): Promise<string> {
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("the test server has no TCP port");
	return `http://127.0.0.1:${address.port}`;
}

async function harness(tokens: Record<string, string> = { work: "work-token", private: "private-token" }) {
	const seen: Seen[] = [];
	const anthropic = http.createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", () => {
			seen.push({ method: req.method, url: req.url, headers: req.headers, body });
			res.writeHead(200, { "content-type": "text/event-stream", "anthropic-organization-id": "org-1" });
			res.write("data: one\n\n");
			res.end("data: two\n\n");
		});
	});
	const keys: Record<string, string> = { "fleet-a": "work", "fleet-b": "private", "fleet-c": "ghost" };
	const proxy = forwarder(new URL(await listen(anthropic)), {
		account: (key) => keys[key],
		token: async (account) => tokens[account],
		log: () => {},
	});
	const base = await listen(proxy);
	const close = () => {
		proxy.close();
		anthropic.close();
	};
	return { seen, base, close };
}

test("a request with a known key reaches Anthropic under that account's token, streamed back unchanged", async (t) => {
	const { seen, base, close } = await harness();
	t.after(close);

	const reply = await fetch(`${base}/v1/messages?beta=true`, {
		method: "POST",
		headers: { authorization: "Bearer fleet-b", "anthropic-beta": "claude-code-20250219", "content-type": "application/json" },
		body: '{"model":"m"}',
	});

	assert.equal(reply.status, 200);
	assert.equal(await reply.text(), "data: one\n\ndata: two\n\n");
	assert.equal(reply.headers.get("anthropic-organization-id"), "org-1");
	assert.equal(seen[0].url, "/v1/messages?beta=true");
	assert.equal(seen[0].body, '{"model":"m"}');
	assert.equal(seen[0].headers.authorization, "Bearer private-token");
	assert.equal(seen[0].headers["anthropic-beta"], "claude-code-20250219,oauth-2025-04-20");
});

test("a key sent as x-api-key is dropped on the way, never reaching Anthropic", async (t) => {
	const { seen, base, close } = await harness();
	t.after(close);

	await fetch(`${base}/v1/messages`, { method: "POST", headers: { "x-api-key": "fleet-a" }, body: "{}" });

	assert.equal(seen[0].headers.authorization, "Bearer work-token");
	assert.equal(seen[0].headers["x-api-key"], undefined);
	assert.equal(seen[0].headers["anthropic-beta"], "oauth-2025-04-20");
});

test("a missing or unknown key is refused here and nothing goes upstream", async (t) => {
	const { seen, base, close } = await harness();
	t.after(close);

	const none = await fetch(`${base}/v1/messages`, { method: "POST", body: "{}" });
	const wrong = await fetch(`${base}/v1/messages`, { method: "POST", headers: { authorization: "Bearer fleet-guess" }, body: "{}" });

	assert.equal(none.status, 401);
	assert.equal(wrong.status, 401);
	assert.equal(seen.length, 0);
});

test("an account without a stored token is refused with the command that stores one", async (t) => {
	const { seen, base, close } = await harness();
	t.after(close);

	const reply = await fetch(`${base}/v1/messages`, { method: "POST", headers: { authorization: "Bearer fleet-c" }, body: "{}" });

	assert.equal(reply.status, 503);
	assert.match(await reply.text(), /fleet account set ghost/);
	assert.equal(seen.length, 0);
});
