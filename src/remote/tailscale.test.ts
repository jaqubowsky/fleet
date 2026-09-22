import assert from "node:assert/strict";
import test from "node:test";
import { serveInfo, tailscale } from "./tailscale.ts";

test("offers the exact Serve command without changing configuration", () => {
	assert.deepEqual(serveInfo({}, "http://127.0.0.1:8787"), {
		command: `'${tailscale}' serve --bg --https=443 http://127.0.0.1:8787`,
	});
});

test("links only the matching private HTTPS proxy", () => {
	const config = {
		TCP: { "443": { HTTPS: true } },
		Web: {
			"mac.tail123.ts.net:443": {
				Handlers: { "/": { Proxy: "http://127.0.0.1:8787" } },
			},
		},
	};
	assert.equal(
		serveInfo(config, "http://127.0.0.1:8787").url,
		"https://mac.tail123.ts.net",
	);
	assert.equal(serveInfo(config, "http://127.0.0.1:9000").url, undefined);
	assert.equal(
		serveInfo(
			{ ...config, AllowFunnel: { "mac.tail123.ts.net:443": true } },
			"http://127.0.0.1:8787",
		).url,
		undefined,
	);
});
