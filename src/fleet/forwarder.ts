import http from "node:http";
import https from "node:https";

const OAUTH_BETA = "oauth-2025-04-20";

export type Route = {
	account(key: string): string | undefined;
	token(account: string): Promise<string | undefined>;
	log(line: string): void;
};

function keyOf(headers: http.IncomingHttpHeaders): string | undefined {
	const bearer = headers.authorization?.match(/^Bearer (.+)$/)?.[1];
	const apiKey = headers["x-api-key"];
	return bearer ?? (typeof apiKey === "string" ? apiKey : undefined);
}

function withOAuthBeta(value: string | string[] | undefined): string {
	const betas = [value ?? []].flat().flatMap((line) => line.split(",")).map((beta) => beta.trim()).filter(Boolean);
	return [...betas, ...(betas.includes(OAUTH_BETA) ? [] : [OAUTH_BETA])].join(",");
}

function refuse(res: http.ServerResponse, status: number, message: string): void {
	if (res.headersSent) {
		res.destroy();
		return;
	}
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify({ type: "error", error: { type: "forwarder_error", message } }));
}

export function forwarder(upstream: URL, route: Route): http.Server {
	const send = upstream.protocol === "https:" ? https.request : http.request;
	return http.createServer(async (req, res) => {
		const key = keyOf(req.headers);
		const account = key && route.account(key);
		if (!account) {
			route.log(`401 ${req.method} ${req.url} unknown key`);
			refuse(res, 401, "this request carries no key fleet up issued; bring the container up again");
			return;
		}
		const token = await route.token(account);
		if (!token) {
			route.log(`503 ${req.method} ${req.url} ${account} has no token`);
			refuse(res, 503, `no token stored for ${account}: fleet account set ${account}`);
			return;
		}
		const headers: http.OutgoingHttpHeaders = {
			...req.headers,
			host: upstream.host,
			authorization: `Bearer ${token}`,
			"anthropic-beta": withOAuthBeta(req.headers["anthropic-beta"]),
		};
		delete headers["x-api-key"];
		const out = send(
			{ protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers },
			(reply) => {
				route.log(`${reply.statusCode} ${req.method} ${req.url} ${account}`);
				res.writeHead(reply.statusCode ?? 502, reply.headers);
				reply.pipe(res);
			},
		);
		out.on("error", (error) => refuse(res, 502, `upstream: ${error.message}`));
		req.pipe(out);
	});
}
