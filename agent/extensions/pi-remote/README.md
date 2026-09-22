# Pi remote

This directory is a separate extension in the repository's Pi home. On the host it lives at `~/.pi/agent/extensions/pi-remote/`; its domain code lives at `~/.pi/src/remote/`. Run `npm ci` at the repository root, then `/reload` in Pi. This is a host extension, not a container sidecar.

## Use

- `/remote start [port]` starts a loopback listener. Default port: 8787. Repeating start preserves the running listener and credential, even with another port argument.
- `/remote status` reports the listener and read-only Tailscale Serve discovery. It also hides the credential widget.
- `/remote link` shows the private URL and QR in an ephemeral terminal widget. It never appends a session entry. Without Serve, this is a loopback-only link.
- `/remote stop` closes phone streams and revokes the credential. Starting again creates a new credential.
- `/remote help` shows usage and the permission warning.

For Tailscale 1.102.4 on macOS, the one-time command for the default port is:

```sh
'/Applications/Tailscale.app/Contents/MacOS/Tailscale' serve --bg --https=443 http://127.0.0.1:8787
```

The extension only runs `serve status --json`. It never applies the command. It recognizes a root HTTPS proxy to this exact listener on a `.ts.net` host, with Funnel disabled. Inspect existing Serve configuration before applying the command, since it may replace an existing root handler. Your phone must be on the same tailnet. The QR and URL grant access to the transcript and the agent's tools; treat them as a password.

## Lifetime

The server, bearer token, socket address and phone streams belong to the terminal process. `/new`, `/resume`, `/fork`, and `/reload` detach only the old session callbacks and bind the fresh API/context on `session_start`. Late events and shutdown from an old instance cannot affect the new binding. During the gap, commands return 503; commands addressed to an older generation return 409. Process quit and explicit stop close the listener. Reloading preserves the running implementation too. Changes to runtime or projection code require restarting the Pi process; stopping and starting remote control does not replace the process-global instance.

The phone keeps its token only in memory, removes the fragment from browser history immediately, and uses an Authorization header. Reloading the phone page requires scanning the link again. Network reconnects and tab wakeups keep the in-memory credential and request a fresh snapshot. Commands are never automatically retried, because an interrupted response might already have been accepted.

## Protocol and bounds

Public static assets: `/`, `/client.js`, `/client.css`. Authenticated endpoints:

- `GET /bootstrap`: version 1 snapshot, generation, session id/name, status, transcript and live assistant/tool text.
- `GET /events`: native HTTP SSE snapshots, with a complete snapshot on every connection. No historical replay or unbounded event journal. Heartbeats every 15 seconds; updates coalesced to at most 10 per second.
- `POST /command`: JSON `{ generation, action, text }`. Actions are `prompt`, `steer`, `followUp`, and `abort`. Abort omits text. Prompt is rejected while busy. Input is plain text, not remote slash-command dispatch.

Projection excludes raw Pi objects, thinking blocks, image payloads, tool arguments/details, usage, auth and model configuration. Displayed text can itself contain secrets present in the conversation; projection is not content redaction. Snapshots contain at most 64 messages, 16 tools and 4096 characters per text field. Older text is omitted. Each command is limited to 16 KiB and 8192 text characters; headers to 8 KiB; connections to 32; phone streams to 8. Slow streams are disconnected after their output queue exceeds 1 MiB and resync on reconnect. Full snapshots trade bandwidth for bounded, lossless state resynchronization within these display limits.

The listener binds only `127.0.0.1`. API requests require a random 256-bit bearer token. Responses are no-store, with a same-origin CSP, no CORS and no external assets. The client renders text without HTML interpretation. Terminal approval dialogs remain on the terminal; the phone shows a waiting status but cannot answer them.

## Verification

`npm run test:remote` exercises real loopback HTTP with session callbacks as doubles. `npm run test:remote-integration` loads the extension entry point, invokes its commands and lifecycle hooks, and proves fresh factories retain process identity, use the current callbacks, and stop/revoke correctly. These checks require no model credentials. They do not prove physical-phone access, QR scanning, or a particular macOS Tailscale/Pi installation.
