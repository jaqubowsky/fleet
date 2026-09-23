import { renameSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";

type Request = { id?: unknown; method?: unknown; params?: { state?: unknown; message?: unknown; seq?: unknown } };

function parsed(line: string): Request {
	try {
		return JSON.parse(line) ?? {};
	} catch {
		return {};
	}
}

function answering(file: string): (connection: net.Socket) => void {
	return (connection) => {
		let buffer = "";
		connection.on("error", () => {});
		connection.on("data", (chunk) => {
			buffer += chunk.toString();
			for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
				const request = parsed(buffer.slice(0, nl));
				buffer = buffer.slice(nl + 1);
				if (request.method === "pane.report_agent") {
					const { state, message, seq } = request.params ?? {};
					writeFileSync(`${file}.tmp`, JSON.stringify({ state, message, seq }));
					renameSync(`${file}.tmp`, file);
				}
				connection.write(`${JSON.stringify({ id: request.id, result: {} })}\n`);
			}
		});
	};
}

export default async function (): Promise<void> {
	const socket = process.env.HERDR_SOCKET_PATH;
	const file = process.env.FLEET_AGENT_STATE;
	if (process.env.HERDR_ENV !== "1" || !socket || !file) return;
	const server = net.createServer(answering(file)).unref();
	await new Promise<void>((resolve) => {
		server.on("listening", () => resolve());
		server.on("error", (error: NodeJS.ErrnoException) => {
			if (error.code !== "EADDRINUSE") return resolve();
			const probe = net.createConnection(socket);
			probe.on("connect", () => {
				probe.destroy();
				resolve();
			});
			probe.on("error", () => {
				rmSync(socket, { force: true });
				server.listen(socket);
			});
		});
		server.listen(socket);
	});
}
